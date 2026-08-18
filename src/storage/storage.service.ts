import {
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'crypto';

const PREVIEW_TTL_SECONDS = 5 * 60;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly folder: string;

  constructor(private readonly config: ConfigService) {
    this.folder = config.get<string>('CLOUDINARY_FOLDER') ?? 'data-room';
  }

  onModuleInit() {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
      secure: true,
    });
  }

  async uploadPdf(
    buffer: Buffer,
    originalName: string,
  ): Promise<{ publicId: string }> {
    const publicId = `${this.folder}/${randomUUID()}`;
    try {
      const result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'raw',
            type: 'authenticated',
            public_id: publicId,
            filename_override: originalName,
            use_filename: true,
            unique_filename: false,
            overwrite: false,
          },
          (error, uploadResult) => {
            if (error || !uploadResult) {
              reject(
                error instanceof Error
                  ? error
                  : new Error('Cloudinary upload failed'),
              );
              return;
            }
            resolve(uploadResult);
          },
        );
        stream.end(buffer);
      });
      return { publicId: result.public_id };
    } catch {
      throw new InternalServerErrorException(
        'Failed to store the uploaded file',
      );
    }
  }

  signedPreviewUrl(publicId: string): { url: string; expiresAt: string } {
    const expiresAt = Math.floor(Date.now() / 1000) + PREVIEW_TTL_SECONDS;
    const url = cloudinary.utils.private_download_url(publicId, '', {
      resource_type: 'raw',
      type: 'authenticated',
      expires_at: expiresAt,
      attachment: false,
    });
    return { url, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async download(publicId: string): Promise<Buffer> {
    const { url } = this.signedPreviewUrl(publicId);
    const response = await fetch(url, { redirect: 'follow' });
    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }

    const fallbackUrl = cloudinary.url(publicId, {
      resource_type: 'raw',
      type: 'authenticated',
      sign_url: true,
      secure: true,
    });
    const fallback = await fetch(fallbackUrl, { redirect: 'follow' });
    if (!fallback.ok) {
      throw new InternalServerErrorException('Failed to load the stored file');
    }
    return Buffer.from(await fallback.arrayBuffer());
  }

  async delete(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'raw',
        type: 'authenticated',
        invalidate: true,
      });
    } catch {
      // Deleting the DB row is more important than a Cloudinary miss.
    }
  }

  async deleteMany(publicIds: string[]): Promise<void> {
    await Promise.all(publicIds.map((id) => this.delete(id)));
  }
}
