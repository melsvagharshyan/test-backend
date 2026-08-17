import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../auth/auth.types';
import { CreateShareDto } from '../common/dto';
import { ResourceType, ShareKind, ShareRole } from '../generated/prisma/client';
import { toFileDto, toFolderDto } from '../common/utils/mappers';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  async list(user: AuthUser, resourceType: ResourceType, resourceId: string) {
    await this.assertOwnerOfResource(user, resourceType, resourceId);
    const where = this.resourceWhere(resourceType, resourceId);
    const shares = await this.prisma.share.findMany({
      where: { ...where, revokedAt: null },
      include: { recipient: true },
      orderBy: { createdAt: 'desc' },
    });
    return shares.map((share) => this.toShareDto(share));
  }

  async create(user: AuthUser, dto: CreateShareDto) {
    const resourceType = dto.resourceType;
    await this.assertOwnerOfResource(user, resourceType, dto.resourceId);

    if (dto.kind === 'PUBLIC_LINK') {
      const existing = await this.prisma.share.findFirst({
        where: {
          ...this.resourceWhere(resourceType, dto.resourceId),
          kind: ShareKind.PUBLIC_LINK,
          revokedAt: null,
        },
      });
      if (existing) {
        return this.toShareDto(existing);
      }
      const created = await this.prisma.share.create({
        data: {
          kind: ShareKind.PUBLIC_LINK,
          role: ShareRole.VIEWER,
          resourceType,
          ...this.resourceIds(resourceType, dto.resourceId),
          grantorId: user.id,
          token: randomBytes(32).toString('base64url'),
        },
      });
      return this.toShareDto(created);
    }

    if (!dto.recipientEmail) {
      throw new BadRequestException('Recipient email is required');
    }
    const email = dto.recipientEmail.toLowerCase();
    if (email === user.email.toLowerCase()) {
      throw new BadRequestException('You already own this item');
    }

    const duplicate = await this.prisma.share.findFirst({
      where: {
        ...this.resourceWhere(resourceType, dto.resourceId),
        kind: ShareKind.USER,
        recipientEmail: email,
        revokedAt: null,
      },
    });
    if (duplicate) {
      throw new BadRequestException('That user already has access');
    }

    const recipient = await this.prisma.user.findUnique({ where: { email } });
    const created = await this.prisma.share.create({
      data: {
        kind: ShareKind.USER,
        role: ShareRole.VIEWER,
        resourceType,
        ...this.resourceIds(resourceType, dto.resourceId),
        grantorId: user.id,
        recipientId: recipient?.id,
        recipientEmail: email,
      },
      include: { recipient: true },
    });
    return this.toShareDto(created);
  }

  async revoke(user: AuthUser, shareId: string) {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });
    if (!share || share.revokedAt) {
      throw new NotFoundException('Share not found');
    }
    if (share.grantorId !== user.id) {
      throw new ForbiddenException('Only the owner can revoke access');
    }
    await this.prisma.share.update({
      where: { id: shareId },
      data: { revokedAt: new Date() },
    });
    return { id: shareId };
  }

  async publicMeta(token: string) {
    const context = await this.access.resolvePublicShare(token);
    const share = context.share;
    if (share.resourceType === ResourceType.DATA_ROOM) {
      const room = await this.prisma.dataRoom.findUnique({
        where: { id: context.dataRoomId },
        include: { owner: true },
      });
      return {
        resourceType: share.resourceType,
        dataRoom: room
          ? { id: room.id, name: room.name, ownerName: room.owner.name }
          : null,
        entryFolderId: context.rootFolderId,
      };
    }
    if (share.resourceType === ResourceType.FOLDER && share.folderId) {
      const folder = await this.prisma.folder.findUnique({
        where: { id: share.folderId },
        include: { dataRoom: { include: { owner: true } } },
      });
      if (!folder) {
        throw new NotFoundException('Shared folder no longer exists');
      }
      return {
        resourceType: share.resourceType,
        dataRoom: {
          id: folder.dataRoom.id,
          name: folder.dataRoom.name,
          ownerName: folder.dataRoom.owner.name,
        },
        folder: { id: folder.id, name: folder.name },
        entryFolderId: folder.id,
      };
    }
    if (share.resourceType === ResourceType.FILE && share.fileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: share.fileId },
        include: { dataRoom: { include: { owner: true } }, folder: true },
      });
      if (!file) {
        throw new NotFoundException('Shared file no longer exists');
      }
      return {
        resourceType: share.resourceType,
        dataRoom: {
          id: file.dataRoom.id,
          name: file.dataRoom.name,
          ownerName: file.dataRoom.owner.name,
        },
        file: toFileDto(file),
        entryFolderId: file.folderId,
      };
    }
    throw new NotFoundException('Shared item no longer exists');
  }

  async publicContents(
    token: string,
    folderId: string | undefined,
    cursor?: string,
  ) {
    const context = await this.access.resolvePublicShare(token);
    const targetId =
      folderId ??
      (context.share.resourceType === ResourceType.FOLDER
        ? context.share.folderId
        : context.rootFolderId);
    if (!targetId) {
      throw new NotFoundException('Folder not found');
    }
    const folder = await this.prisma.folder.findUnique({
      where: { id: targetId },
    });
    if (!folder || folder.dataRoomId !== context.dataRoomId) {
      throw new NotFoundException('Folder not found');
    }
    this.access.assertPublicCanReadFolder(context, folder.path, folder.id);

    const folders =
      context.share.resourceType === ResourceType.FILE
        ? []
        : await this.prisma.folder.findMany({
            where: { parentId: folder.id, dataRoomId: folder.dataRoomId },
            orderBy: { name: 'asc' },
          });
    const files = await this.prisma.file.findMany({
      where: {
        folderId: folder.id,
        ...(context.share.resourceType === ResourceType.FILE &&
        context.share.fileId
          ? { id: context.share.fileId }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = files.length > 50;
    const page = hasMore ? files.slice(0, 50) : files;
    return {
      folder: toFolderDto(folder),
      folders: folders.map(toFolderDto),
      files: page.map(toFileDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      access: 'VIEWER' as const,
    };
  }

  async publicPreview(token: string, fileId: string) {
    const context = await this.access.resolvePublicShare(token);
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { folder: true },
    });
    if (!file || file.dataRoomId !== context.dataRoomId) {
      throw new NotFoundException('File not found');
    }
    this.access.assertPublicCanReadFile(
      context,
      file.folder.path,
      file.folderId,
      file.id,
    );
    const signed = this.storage.signedPreviewUrl(file.cloudinaryPublicId);
    return { file: toFileDto(file), ...signed };
  }

  private async assertOwnerOfResource(
    user: AuthUser,
    resourceType: ResourceType,
    resourceId: string,
  ) {
    if (resourceType === ResourceType.DATA_ROOM) {
      await this.access.assertRoomAccess(user, resourceId, 'write');
      return;
    }
    if (resourceType === ResourceType.FOLDER) {
      await this.access.assertFolderAccess(user, resourceId, 'write');
      return;
    }
    await this.access.assertFileAccess(user, resourceId, 'write');
  }

  private resourceWhere(resourceType: ResourceType, resourceId: string) {
    if (resourceType === ResourceType.DATA_ROOM) {
      return { resourceType, dataRoomId: resourceId };
    }
    if (resourceType === ResourceType.FOLDER) {
      return { resourceType, folderId: resourceId };
    }
    return { resourceType, fileId: resourceId };
  }

  private resourceIds(resourceType: ResourceType, resourceId: string) {
    if (resourceType === ResourceType.DATA_ROOM) {
      return { dataRoomId: resourceId };
    }
    if (resourceType === ResourceType.FOLDER) {
      return { folderId: resourceId };
    }
    return { fileId: resourceId };
  }

  private toShareDto(share: {
    id: string;
    kind: ShareKind;
    role: ShareRole;
    resourceType: ResourceType;
    recipientEmail: string | null;
    token: string | null;
    createdAt: Date;
    recipient?: { id: string; name: string; email: string } | null;
  }) {
    return {
      id: share.id,
      kind: share.kind,
      role: share.role,
      resourceType: share.resourceType,
      recipientEmail: share.recipientEmail,
      recipient: share.recipient
        ? {
            id: share.recipient.id,
            name: share.recipient.name,
            email: share.recipient.email,
          }
        : null,
      token: share.token,
      createdAt: share.createdAt.toISOString(),
    };
  }
}
