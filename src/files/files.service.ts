import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { StorageService } from '../storage/storage.service';
import { AuthUser } from '../auth/auth.types';
import { MoveFileDto, RenameDto } from '../common/dto';
import { applyStatsDelta } from '../common/utils/aggregates';
import { isPdfUpload, resolveUniqueName } from '../common/utils/naming';
import { toFileDto } from '../common/utils/mappers';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    user: AuthUser,
    dataRoomId: string,
    folderId: string | undefined,
    files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('Select at least one PDF to upload');
    }

    const room = await this.access.assertRoomAccess(user, dataRoomId, 'write');
    const targetFolderId = folderId ?? room.rootFolderId;
    const folder = await this.prisma.folder.findFirst({
      where: { id: targetFolderId, dataRoomId },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }

    const existing = await this.prisma.file.findMany({
      where: { folderId: folder.id },
      select: { name: true },
    });
    const taken = new Set(existing.map((item) => item.name));
    const results: ReturnType<typeof toFileDto>[] = [];
    const errors: { name: string; message: string }[] = [];

    for (const file of files) {
      try {
        if (!isPdfUpload(file)) {
          throw new BadRequestException('Only PDF files are allowed');
        }
        if (file.size > MAX_FILE_BYTES) {
          throw new BadRequestException('Each PDF must be 20MB or smaller');
        }

        const name = resolveUniqueName(file.originalname, taken, {
          treatAsFile: true,
        });
        taken.add(name);

        const stored = await this.storage.uploadPdf(file.buffer, name);
        try {
          const created = await this.prisma.file.create({
            data: {
              name,
              mimeType: file.mimetype || 'application/pdf',
              size: file.size,
              dataRoomId,
              folderId: folder.id,
              cloudinaryPublicId: stored.publicId,
            },
          });
          await applyStatsDelta(this.prisma, {
            folderPath: folder.path,
            dataRoomId,
            itemDelta: 1,
            sizeDelta: BigInt(file.size),
          });
          results.push(toFileDto(created));
        } catch (error) {
          await this.storage.delete(stored.publicId);
          throw error;
        }
      } catch (error) {
        errors.push({
          name: file.originalname,
          message: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    }

    return { files: results, errors };
  }

  async rename(user: AuthUser, fileId: string, dto: RenameDto) {
    const access = await this.access.assertFileAccess(user, fileId, 'write');
    const file = await this.requireFile(fileId);
    const siblings = await this.prisma.file.findMany({
      where: { folderId: access.folderId, id: { not: file.id } },
      select: { name: true },
    });
    const name = resolveUniqueName(
      dto.name.trim(),
      siblings.map((item) => item.name),
      {
        treatAsFile: true,
      },
    );
    const updated = await this.prisma.file.update({
      where: { id: file.id },
      data: { name },
    });
    return toFileDto(updated);
  }

  async move(user: AuthUser, fileId: string, dto: MoveFileDto) {
    const access = await this.access.assertFileAccess(user, fileId, 'write');
    const file = await this.requireFile(fileId);
    if (dto.folderId === file.folderId) {
      return toFileDto(file);
    }

    const destination = await this.prisma.folder.findFirst({
      where: { id: dto.folderId, dataRoomId: access.dataRoomId },
    });
    if (!destination) {
      throw new NotFoundException('Destination folder not found');
    }

    const siblings = await this.prisma.file.findMany({
      where: { folderId: destination.id },
      select: { name: true },
    });
    const name = resolveUniqueName(
      file.name,
      siblings.map((item) => item.name),
      {
        treatAsFile: true,
      },
    );

    const sourceFolder = await this.prisma.folder.findUnique({
      where: { id: file.folderId },
    });
    if (!sourceFolder) {
      throw new NotFoundException('Source folder not found');
    }

    const updated = await this.prisma.file.update({
      where: { id: file.id },
      data: { folderId: destination.id, name },
    });

    await applyStatsDelta(this.prisma, {
      folderPath: sourceFolder.path,
      dataRoomId: file.dataRoomId,
      itemDelta: -1,
      sizeDelta: -BigInt(file.size),
    });
    await applyStatsDelta(this.prisma, {
      folderPath: destination.path,
      dataRoomId: file.dataRoomId,
      itemDelta: 1,
      sizeDelta: BigInt(file.size),
    });

    return toFileDto(updated);
  }

  async remove(user: AuthUser, fileId: string) {
    await this.access.assertFileAccess(user, fileId, 'write');
    const file = await this.requireFile(fileId);
    const folder = await this.prisma.folder.findUnique({
      where: { id: file.folderId },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    await this.prisma.file.delete({ where: { id: file.id } });
    await applyStatsDelta(this.prisma, {
      folderPath: folder.path,
      dataRoomId: file.dataRoomId,
      itemDelta: -1,
      sizeDelta: -BigInt(file.size),
    });
    await this.storage.delete(file.cloudinaryPublicId);
    return { id: file.id };
  }

  async preview(user: AuthUser, fileId: string) {
    await this.access.assertFileAccess(user, fileId, 'read');
    const file = await this.requireFile(fileId);
    const signed = this.storage.signedPreviewUrl(file.cloudinaryPublicId);
    return {
      file: toFileDto(file),
      ...signed,
    };
  }

  async download(user: AuthUser, fileId: string) {
    await this.access.assertFileAccess(user, fileId, 'read');
    const file = await this.requireFile(fileId);
    const buffer = await this.storage.download(file.cloudinaryPublicId);
    return { file, buffer };
  }

  private async requireFile(fileId: string) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundException('File not found');
    }
    return file;
  }
}
