import { ForbiddenException } from '@nestjs/common';
import { ancestorIdsFromPath } from '../common/utils/naming';

export type ShareScopeContext = {
  role: 'OWNER' | 'VIEWER';
  share?: {
    resourceType: 'DATA_ROOM' | 'FOLDER' | 'FILE';
    fileId: string | null;
    folderId: string | null;
  };
  allowedFolderIds?: string[] | null;
};

export function assertWithinShareScope(
  context: ShareScopeContext,
  folderPath: string,
  folderId: string,
  fileId?: string,
) {
  if (context.role === 'OWNER' || !context.share) {
    return;
  }

  if (context.share.resourceType === 'DATA_ROOM') {
    return;
  }

  if (context.share.resourceType === 'FILE') {
    if (fileId) {
      if (context.share.fileId === fileId) {
        return;
      }
      throw new ForbiddenException('This item is outside the shared scope');
    }
    if (context.allowedFolderIds?.includes(folderId)) {
      return;
    }
    throw new ForbiddenException('This item is outside the shared scope');
  }

  if (context.share.resourceType === 'FOLDER') {
    const sharedFolderId = context.share.folderId;
    if (!sharedFolderId) {
      throw new ForbiddenException('This item is outside the shared scope');
    }
    const ids = new Set(ancestorIdsFromPath(folderPath));
    ids.add(folderId);
    if (ids.has(sharedFolderId)) {
      return;
    }
    throw new ForbiddenException('This item is outside the shared scope');
  }
}
