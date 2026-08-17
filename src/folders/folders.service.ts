import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { StorageService } from '../storage/storage.service';
import { AuthUser } from '../auth/auth.types';
import { CreateFolderDto, RenameDto } from '../common/dto';
import { applyStatsDelta } from '../common/utils/aggregates';
import { ancestorIdsFromPath, resolveUniqueName } from '../common/utils/naming';
import { toBreadcrumb, toFileDto, toFolderDto } from '../common/utils/mappers';
import { Folder } from '../generated/prisma/client';

const DEFAULT_LIMIT = 50;

@Injectable()
export class FoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  async listContents(
    user: AuthUser,
    dataRoomId: string,
    query: { folderId?: string; cursor?: string; limit?: number },
  ) {
    const roomContext = await this.access.assertRoomAccess(
      user,
      dataRoomId,
      'read',
    );
    const folderId = query.folderId ?? roomContext.entryFolderId;
    const folderAccess = await this.access.assertFolderAccess(
      user,
      folderId,
      'read',
    );
    const folder = await this.requireFolder(folderAccess.folderId, dataRoomId);

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 100);
    const folders =
      roomContext.share?.resourceType === 'FILE'
        ? []
        : await this.prisma.folder.findMany({
            where: { dataRoomId, parentId: folder.id },
            orderBy: { name: 'asc' },
          });
    const files = await this.prisma.file.findMany({
      where: {
        folderId: folder.id,
        ...(roomContext.share?.resourceType === 'FILE' &&
        roomContext.share.fileId
          ? { id: roomContext.share.fileId }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = files.length > limit;
    const page = hasMore ? files.slice(0, limit) : files;
    const breadcrumbFolders = await this.loadBreadcrumb(folder);

    return {
      folder: toFolderDto(folder),
      breadcrumb: toBreadcrumb(breadcrumbFolders),
      folders: folders.map(toFolderDto),
      files: page.map(toFileDto),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      access: roomContext.role,
    };
  }

  async create(user: AuthUser, dataRoomId: string, dto: CreateFolderDto) {
    const roomContext = await this.access.assertRoomAccess(
      user,
      dataRoomId,
      'write',
    );
    const parentId = dto.parentId ?? roomContext.rootFolderId;
    const parent = await this.requireFolder(parentId, dataRoomId);
    if (parent.parentId === null && parent.id !== roomContext.rootFolderId) {
      throw new BadRequestException('Invalid parent folder');
    }

    const siblings = await this.prisma.folder.findMany({
      where: { dataRoomId, parentId: parent.id },
      select: { name: true },
    });
    const name = resolveUniqueName(
      dto.name.trim(),
      siblings.map((item) => item.name),
    );

    const created = await this.prisma.folder.create({
      data: {
        name,
        dataRoomId,
        parentId: parent.id,
        parentKey: parent.id,
        path: 'pending',
      },
    });
    const folder = await this.prisma.folder.update({
      where: { id: created.id },
      data: { path: `${parent.path}/${created.id}` },
    });
    await applyStatsDelta(this.prisma, {
      folderPath: parent.path,
      dataRoomId,
      itemDelta: 1,
      sizeDelta: 0n,
    });
    return toFolderDto(folder);
  }

  async rename(user: AuthUser, folderId: string, dto: RenameDto) {
    const access = await this.access.assertFolderAccess(
      user,
      folderId,
      'write',
    );
    const folder = await this.requireFolder(folderId, access.dataRoomId);
    if (!folder.parentId) {
      throw new BadRequestException(
        'Rename the data room instead of the root folder',
      );
    }
    const siblings = await this.prisma.folder.findMany({
      where: {
        dataRoomId: folder.dataRoomId,
        parentId: folder.parentId,
        id: { not: folder.id },
      },
      select: { name: true },
    });
    const name = resolveUniqueName(
      dto.name.trim(),
      siblings.map((item) => item.name),
    );
    const updated = await this.prisma.folder.update({
      where: { id: folder.id },
      data: { name },
    });
    return toFolderDto(updated);
  }

  async deletePreview(user: AuthUser, folderId: string) {
    const access = await this.access.assertFolderAccess(
      user,
      folderId,
      'write',
    );
    const folder = await this.requireFolder(folderId, access.dataRoomId);
    if (!folder.parentId) {
      throw new BadRequestException(
        'Delete the data room to remove the root folder',
      );
    }
    return this.buildDeletePreview(folder);
  }

  async remove(user: AuthUser, folderId: string) {
    const access = await this.access.assertFolderAccess(
      user,
      folderId,
      'write',
    );
    const folder = await this.requireFolder(folderId, access.dataRoomId);
    if (!folder.parentId) {
      throw new BadRequestException(
        'Delete the data room to remove the root folder',
      );
    }

    const subtree = await this.prisma.folder.findMany({
      where: {
        dataRoomId: folder.dataRoomId,
        path: { startsWith: folder.path },
      },
    });
    const subtreeIds = subtree.map((item) => item.id);
    const files = await this.prisma.file.findMany({
      where: { folderId: { in: subtreeIds } },
      select: { cloudinaryPublicId: true },
    });

    const parent = await this.prisma.folder.findUnique({
      where: { id: folder.parentId },
    });
    if (!parent) {
      throw new NotFoundException('Parent folder not found');
    }

    await this.prisma.folder.delete({ where: { id: folder.id } });
    await applyStatsDelta(this.prisma, {
      folderPath: parent.path,
      dataRoomId: folder.dataRoomId,
      itemDelta: -(folder.itemCount + 1),
      sizeDelta: -folder.totalSize,
    });
    await this.storage.deleteMany(files.map((file) => file.cloudinaryPublicId));
    return { id: folder.id };
  }

  async search(user: AuthUser, dataRoomId: string, q: string) {
    const context = await this.access.assertRoomAccess(
      user,
      dataRoomId,
      'read',
    );
    const term = q.trim();
    const folderFilter = context.allowedFolderIds
      ? { id: { in: context.allowedFolderIds } }
      : { dataRoomId };
    const fileFilter = context.allowedFolderIds
      ? { folderId: { in: context.allowedFolderIds } }
      : { dataRoomId };

    const [folders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: {
          ...folderFilter,
          parentId: { not: null },
          name: { contains: term, mode: 'insensitive' },
        },
        take: 25,
        orderBy: { name: 'asc' },
      }),
      this.prisma.file.findMany({
        where: {
          ...fileFilter,
          name: { contains: term, mode: 'insensitive' },
        },
        take: 25,
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      folders: folders.map(toFolderDto),
      files: files.map(toFileDto),
    };
  }

  async buildDeletePreview(folder: Folder) {
    const nestedFolders = await this.prisma.folder.findMany({
      where: {
        dataRoomId: folder.dataRoomId,
        path: { startsWith: folder.path },
        id: { not: folder.id },
      },
      select: { name: true },
      take: 8,
    });
    const files = await this.prisma.file.findMany({
      where: {
        folder: {
          dataRoomId: folder.dataRoomId,
          path: { startsWith: folder.path },
        },
      },
      select: { name: true },
      take: 8,
    });

    return {
      folderId: folder.id,
      folderName: folder.name,
      folderCount:
        folder.itemCount >= 0 ? await this.countNestedFolders(folder) : 0,
      fileCount: await this.prisma.file.count({
        where: {
          folder: {
            dataRoomId: folder.dataRoomId,
            path: { startsWith: folder.path },
          },
        },
      }),
      totalSize: folder.totalSize.toString(),
      sampleNames: [
        ...nestedFolders.map((item) => item.name),
        ...files.map((item) => item.name),
      ].slice(0, 8),
    };
  }

  private async countNestedFolders(folder: Folder) {
    return this.prisma.folder.count({
      where: {
        dataRoomId: folder.dataRoomId,
        path: { startsWith: folder.path },
        id: { not: folder.id },
      },
    });
  }

  private async loadBreadcrumb(folder: Folder) {
    const ids = ancestorIdsFromPath(folder.path);
    if (ids.length === 0) {
      return [folder];
    }
    const folders = await this.prisma.folder.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(folders.map((item) => [item.id, item]));
    return ids
      .map((id) => byId.get(id))
      .filter((item): item is Folder => Boolean(item));
  }

  private async requireFolder(folderId: string, dataRoomId: string) {
    const folder = await this.prisma.folder.findFirst({
      where: { id: folderId, dataRoomId },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }
}
