import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FilesService } from './files.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { MoveFileDto, RenameDto } from '../common/dto';

@Controller()
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('data-rooms/:id/files')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('folderId') folderId: string | undefined,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return {
      data: await this.filesService.upload(user, id, folderId, files),
    };
  }

  @Get('files/:id')
  async preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.filesService.preview(user, id) };
  }

  @Patch('files/:id')
  async rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    return { data: await this.filesService.rename(user, id, dto) };
  }

  @Post('files/:id/move')
  async move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveFileDto,
  ) {
    return { data: await this.filesService.move(user, id, dto) };
  }

  @Delete('files/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.filesService.remove(user, id) };
  }
}
