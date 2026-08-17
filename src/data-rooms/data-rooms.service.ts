import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../auth/auth.types';
import { CreateDataRoomDto, UpdateDataRoomDto } from '../common/dto';
import { toDataRoomDto } from '../common/utils/mappers';
import { ResourceType, ShareKind } from '../generated/prisma/client';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class DataRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  async list(user: AuthUser) {
    const owned = await this.prisma.dataRoom.findMany({
      where: { ownerId: user.id },
      include: {
        owner: true,
        folders: { where: { parentId: null }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const shares = await this.prisma.share.findMany({
      where: {
        revokedAt: null,
        kind: ShareKind.USER,
        OR: [
          { recipientId: user.id },
          { recipientEmail: user.email.toLowerCase() },
        ],
        NOT: { grantorId: user.id },
      },
      include: {
        dataRoom: {
          include: {
            owner: true,
            folders: { where: { parentId: null }, take: 1 },
          },
        },
        folder: { include: { dataRoom: { include: { owner: true } } } },
        file: { include: { dataRoom: { include: { owner: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const shared: Array<{
      shareId: string;
      resourceType: string;
      role: string;
      dataRoom: unknown;
      folder?: { id: string; name: string; dataRoomId: string };
      file?: { id: string; name: string; folderId: string; dataRoomId: string };
    }> = [];

    for (const share of shares) {
      if (share.resourceType === ResourceType.DATA_ROOM && share.dataRoom) {
        const rootId = share.dataRoom.folders[0]?.id ?? '';
        shared.push({
          shareId: share.id,
          resourceType: share.resourceType,
          role: share.role,
          dataRoom: toDataRoomDto(share.dataRoom, {
            rootFolderId: rootId,
            entryFolderId: rootId,
            access: 'VIEWER',
          }),
        });
        continue;
      }
      if (share.resourceType === ResourceType.FOLDER && share.folder) {
        shared.push({
          shareId: share.id,
          resourceType: share.resourceType,
          role: share.role,
          dataRoom: {
            id: share.folder.dataRoom.id,
            name: share.folder.dataRoom.name,
            owner: {
              id: share.folder.dataRoom.owner.id,
              email: share.folder.dataRoom.owner.email,
              name: share.folder.dataRoom.owner.name,
            },
          },
          folder: {
            id: share.folder.id,
            name: share.folder.name,
            dataRoomId: share.folder.dataRoomId,
          },
        });
        continue;
      }
      if (share.resourceType === ResourceType.FILE && share.file) {
        shared.push({
          shareId: share.id,
          resourceType: share.resourceType,
          role: share.role,
          dataRoom: {
            id: share.file.dataRoom.id,
            name: share.file.dataRoom.name,
            owner: {
              id: share.file.dataRoom.owner.id,
              email: share.file.dataRoom.owner.email,
              name: share.file.dataRoom.owner.name,
            },
          },
          file: {
            id: share.file.id,
            name: share.file.name,
            folderId: share.file.folderId,
            dataRoomId: share.file.dataRoomId,
          },
        });
      }
    }

    return {
      owned: owned.map((room) =>
        toDataRoomDto(room, {
          rootFolderId: room.folders[0]?.id ?? '',
          entryFolderId: room.folders[0]?.id ?? '',
          access: 'OWNER',
        }),
      ),
      shared,
    };
  }

  async create(user: AuthUser, dto: CreateDataRoomDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const room = await tx.dataRoom.create({
        data: {
          name: dto.name.trim(),
          ownerId: user.id,
        },
      });
      const root = await tx.folder.create({
        data: {
          name: room.name,
          dataRoomId: room.id,
          parentId: null,
          parentKey: 'root',
          path: 'pending',
        },
      });
      await tx.folder.update({
        where: { id: root.id },
        data: { path: `/${root.id}` },
      });
      return room.id;
    });
    const room = await this.prisma.dataRoom.findUnique({
      where: { id: created },
      include: { owner: true, folders: { where: { parentId: null }, take: 1 } },
    });
    if (!room || !room.folders[0]) {
      throw new NotFoundException('Data room not found');
    }

    return toDataRoomDto(room, {
      rootFolderId: room.folders[0].id,
      entryFolderId: room.folders[0].id,
      access: 'OWNER',
    });
  }

  async get(user: AuthUser, id: string) {
    const context = await this.access.assertRoomAccess(user, id, 'read');
    const room = await this.prisma.dataRoom.findUnique({
      where: { id },
      include: { owner: true, folders: { where: { parentId: null }, take: 1 } },
    });
    if (!room || !room.folders[0]) {
      throw new NotFoundException('Data room not found');
    }

    const entryFolderId =
      context.share?.resourceType === ResourceType.FOLDER &&
      context.share.folderId
        ? context.share.folderId
        : context.share?.resourceType === ResourceType.FILE
          ? ((
              await this.prisma.file.findUnique({
                where: { id: context.share.fileId ?? '' },
              })
            )?.folderId ?? room.folders[0].id)
          : room.folders[0].id;

    return toDataRoomDto(room, {
      rootFolderId: room.folders[0].id,
      entryFolderId,
      access: context.role,
    });
  }

  async rename(user: AuthUser, id: string, dto: UpdateDataRoomDto) {
    await this.access.assertRoomAccess(user, id, 'write');
    const room = await this.prisma.dataRoom.update({
      where: { id },
      data: { name: dto.name.trim() },
      include: { owner: true, folders: { where: { parentId: null }, take: 1 } },
    });
    if (room.folders[0]) {
      await this.prisma.folder.update({
        where: { id: room.folders[0].id },
        data: { name: dto.name.trim() },
      });
    }
    return toDataRoomDto(room, {
      rootFolderId: room.folders[0]?.id ?? '',
      entryFolderId: room.folders[0]?.id ?? '',
      access: 'OWNER',
    });
  }

  async remove(user: AuthUser, id: string) {
    await this.access.assertRoomAccess(user, id, 'write');
    const files = await this.prisma.file.findMany({
      where: { dataRoomId: id },
      select: { cloudinaryPublicId: true },
    });
    await this.prisma.dataRoom.delete({ where: { id } });
    await this.storage.deleteMany(files.map((file) => file.cloudinaryPublicId));
    return { id };
  }
}
