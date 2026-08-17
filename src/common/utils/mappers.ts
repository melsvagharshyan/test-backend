import { serializeSize } from './naming';
import type { AccessRole } from '../../auth/auth.types';
import type { File, Folder, User } from '../../generated/prisma/client';

export function toUserDto(user: Pick<User, 'id' | 'email' | 'name'>) {
  return { id: user.id, email: user.email, name: user.name };
}

export function toDataRoomDto(
  room: {
    id: string;
    name: string;
    itemCount: number;
    totalSize: bigint;
    createdAt: Date;
    updatedAt: Date;
    owner: Pick<User, 'id' | 'email' | 'name'>;
  },
  extras: { rootFolderId: string; access: AccessRole; entryFolderId: string },
) {
  return {
    id: room.id,
    name: room.name,
    owner: toUserDto(room.owner),
    itemCount: room.itemCount,
    totalSize: serializeSize(room.totalSize),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    rootFolderId: extras.rootFolderId,
    entryFolderId: extras.entryFolderId,
    access: extras.access,
  };
}

export function toFolderDto(folder: Folder) {
  return {
    id: folder.id,
    name: folder.name,
    dataRoomId: folder.dataRoomId,
    parentId: folder.parentId,
    path: folder.path,
    itemCount: folder.itemCount,
    totalSize: serializeSize(folder.totalSize),
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function toFileDto(file: File) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    dataRoomId: file.dataRoomId,
    folderId: file.folderId,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

export function toBreadcrumb(folders: Folder[]) {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
  }));
}
