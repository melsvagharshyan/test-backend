import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SharesService } from './shares.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CreateShareDto } from '../common/dto';
import { Public } from '../common/decorators/public.decorator';
import { ResourceType } from '../generated/prisma/client';

@Controller()
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Get('shares')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('resourceType') resourceType: ResourceType,
    @Query('resourceId') resourceId: string,
  ) {
    return {
      data: await this.sharesService.list(user, resourceType, resourceId),
    };
  }

  @Post('shares')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateShareDto) {
    return { data: await this.sharesService.create(user, dto) };
  }

  @Delete('shares/:id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.sharesService.revoke(user, id) };
  }

  @Public()
  @Get('public/:token')
  async publicMeta(@Param('token') token: string) {
    return { data: await this.sharesService.publicMeta(token) };
  }

  @Public()
  @Get('public/:token/contents')
  async publicContents(
    @Param('token') token: string,
    @Query('folderId') folderId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return {
      data: await this.sharesService.publicContents(token, folderId, cursor),
    };
  }

  @Public()
  @Get('public/:token/files/:fileId')
  async publicPreview(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
  ) {
    return { data: await this.sharesService.publicPreview(token, fileId) };
  }
}
