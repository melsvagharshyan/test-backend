import { ForbiddenException } from '@nestjs/common';
import { assertWithinShareScope } from './share-scope';

describe('assertWithinShareScope', () => {
  const viewerContext = {
    role: 'VIEWER' as const,
    allowedFolderIds: ['folder-shared', 'folder-child'],
    share: {
      resourceType: 'FOLDER' as const,
      dataRoomId: null,
      folderId: 'folder-shared',
      fileId: null,
    },
  };

  it('allows a shared folder and its descendants', () => {
    expect(() =>
      assertWithinShareScope(
        viewerContext,
        '/root-1/folder-shared/folder-child',
        'folder-child',
      ),
    ).not.toThrow();
  });

  it('rejects a sibling folder outside the shared subtree', () => {
    expect(() =>
      assertWithinShareScope(
        viewerContext,
        '/root-1/folder-other',
        'folder-other',
      ),
    ).toThrow(ForbiddenException);
  });
});
