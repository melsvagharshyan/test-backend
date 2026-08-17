import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessRole } from '../auth/auth.types';
import { ResourceType, Share, ShareKind } from '../generated/prisma/client';
import { assertWithinShareScope } from './share-scope';

export type AccessContext = {
  role: AccessRole;
  dataRoomId: string;
  rootFolderId: string;
  entryFolderId: string;
  share?: Share;
  allowedFolderIds?: string[] | null;
};

type PublicShareContext = {
  share: Share;
  dataRoomId: string;
  rootFolderId: string;
  allowedFolderIds: string[] | null;
};

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertRoomAccess(
    user: { id: string; email: string },
    dataRoomId: string,
    mode: 'read' | 'write',
  ): Promise<AccessContext> {
    const room = await this.prisma.dataRoom.findUnique({
      where: { id: dataRoomId },
      include: { folders: { where: { parentId: null }, take: 1 } },
    });
    if (!room || !room.folders[0]) {
      throw new NotFoundException('Data room not found');
    }

    if (room.ownerId === user.id) {
      return {
        role: 'OWNER',
        dataRoomId: room.id,
        rootFolderId: room.folders[0].id,
        entryFolderId: room.folders[0].id,
      };
    }

    if (mode === 'write') {
      throw new ForbiddenException('Only the owner can make changes');
    }

    const share = await this.findActiveUserShare(user, {
      dataRoomId: room.id,
    });
    if (!share) {
      throw new ForbiddenException('You do not have access to this data room');
    }

    const allowedFolderIds = await this.allowedFolderIdsForShare(share);
    return {
      role: 'VIEWER',
      dataRoomId: room.id,
      rootFolderId: room.folders[0].id,
      entryFolderId: await this.entryFolderIdForShare(
        share,
        room.folders[0].id,
      ),
      share,
      allowedFolderIds,
    };
  }

  async assertFolderAccess(
    user: { id: string; email: string },
    folderId: string,
    mode: 'read' | 'write',
  ): Promise<AccessContext & { folderId: string; folderPath: string }> {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      include: { dataRoom: true },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const context = await this.assertRoomAccess(user, folder.dataRoomId, mode);
    assertWithinShareScope(context, folder.path, folder.id);
    return {
      ...context,
      folderId: folder.id,
      folderPath: folder.path,
    };
  }

  async assertFileAccess(
    user: { id: string; email: string },
    fileId: string,
    mode: 'read' | 'write',
  ): Promise<AccessContext & { fileId: string; folderId: string }> {
    const file = await this.prisma.file.findUnique({
      where: { id: fileId },
      include: { folder: true },
    });
    if (!file) {
      throw new NotFoundException('File not found');
    }

    const context = await this.assertRoomAccess(user, file.dataRoomId, mode);
    assertWithinShareScope(context, file.folder.path, file.folderId, file.id);
    return {
      ...context,
      fileId: file.id,
      folderId: file.folderId,
    };
  }

  async resolvePublicShare(token: string): Promise<PublicShareContext> {
    const share = await this.prisma.share.findFirst({
      where: { token, kind: ShareKind.PUBLIC_LINK, revokedAt: null },
    });
    if (!share) {
      throw new NotFoundException('This link is invalid or has been revoked');
    }

    const dataRoomId = await this.dataRoomIdForShare(share);
    const root = await this.prisma.folder.findFirst({
      where: { dataRoomId, parentId: null },
    });
    if (!root) {
      throw new NotFoundException('Shared item no longer exists');
    }

    return {
      share,
      dataRoomId,
      rootFolderId: root.id,
      allowedFolderIds: await this.allowedFolderIdsForShare(share),
    };
  }

  assertPublicCanReadFolder(
    context: PublicShareContext,
    folderPath: string,
    folderId: string,
  ) {
    assertWithinShareScope(
      {
        role: 'VIEWER',
        share: context.share,
        allowedFolderIds: context.allowedFolderIds,
      },
      folderPath,
      folderId,
    );
  }

  assertPublicCanReadFile(
    context: PublicShareContext,
    folderPath: string,
    folderId: string,
    fileId: string,
  ) {
    assertWithinShareScope(
      {
        role: 'VIEWER',
        share: context.share,
        allowedFolderIds: context.allowedFolderIds,
      },
      folderPath,
      folderId,
      fileId,
    );
  }

  private async findActiveUserShare(
    user: { id: string; email: string },
    scope: { dataRoomId: string },
  ) {
    const shares = await this.prisma.share.findMany({
      where: {
        revokedAt: null,
        kind: ShareKind.USER,
        OR: [
          { recipientId: user.id },
          { recipientEmail: user.email.toLowerCase() },
        ],
        AND: [
          {
            OR: [
              {
                dataRoomId: scope.dataRoomId,
                resourceType: ResourceType.DATA_ROOM,
              },
              { folder: { dataRoomId: scope.dataRoomId } },
              { file: { dataRoomId: scope.dataRoomId } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    return (
      shares.find((share) => share.resourceType === ResourceType.DATA_ROOM) ??
      shares[0] ??
      null
    );
  }

  private async entryFolderIdForShare(share: Share, rootFolderId: string) {
    if (share.resourceType === ResourceType.FOLDER && share.folderId) {
      return share.folderId;
    }
    if (share.resourceType === ResourceType.FILE && share.fileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: share.fileId },
      });
      return file?.folderId ?? rootFolderId;
    }
    return rootFolderId;
  }

  private async allowedFolderIdsForShare(
    share: Share,
  ): Promise<string[] | null> {
    if (share.resourceType === ResourceType.DATA_ROOM) {
      return null;
    }
    if (share.resourceType === ResourceType.FILE) {
      const file = await this.prisma.file.findUnique({
        where: { id: share.fileId ?? '' },
      });
      return file ? [file.folderId] : [];
    }
    if (!share.folderId) {
      return [];
    }
    const folder = await this.prisma.folder.findUnique({
      where: { id: share.folderId },
    });
    if (!folder) {
      return [];
    }
    const descendants = await this.prisma.folder.findMany({
      where: {
        dataRoomId: folder.dataRoomId,
        path: { startsWith: folder.path },
      },
      select: { id: true },
    });
    return descendants.map((item) => item.id);
  }

  private async dataRoomIdForShare(share: Share): Promise<string> {
    if (share.dataRoomId) {
      return share.dataRoomId;
    }
    if (share.folderId) {
      const folder = await this.prisma.folder.findUnique({
        where: { id: share.folderId },
      });
      if (folder) {
        return folder.dataRoomId;
      }
    }
    if (share.fileId) {
      const file = await this.prisma.file.findUnique({
        where: { id: share.fileId },
      });
      if (file) {
        return file.dataRoomId;
      }
    }
    throw new NotFoundException('Shared item no longer exists');
  }
}
