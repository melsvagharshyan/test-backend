import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DataRoomsService } from './data-rooms.service';
import { FoldersService } from '../folders/folders.service';
import { FilesService } from '../files/files.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import {
  CreateDataRoomDto,
  CreateFolderDto,
  SearchQueryDto,
  UpdateDataRoomDto,
} from '../common/dto';

@Controller('data-rooms')
export class DataRoomsController {
  constructor(
    private readonly dataRoomsService: DataRoomsService,
    private readonly foldersService: FoldersService,
    private readonly filesService: FilesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { data: await this.dataRoomsService.list(user) };
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateDataRoomDto) {
    return { data: await this.dataRoomsService.create(user, dto) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.dataRoomsService.get(user, id) };
  }

  @Patch(':id')
  async rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDataRoomDto,
  ) {
    return { data: await this.dataRoomsService.rename(user, id, dto) };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.dataRoomsService.remove(user, id) };
  }

  @Get(':id/contents')
  async contents(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('folderId') folderId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return {
      data: await this.foldersService.listContents(user, id, {
        folderId,
        cursor,
        limit: limit ? Number(limit) : undefined,
      }),
    };
  }

  @Get(':id/search')
  async search(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: SearchQueryDto,
  ) {
    return { data: await this.foldersService.search(user, id, query.q) };
  }

  @Post(':id/folders')
  async createFolder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateFolderDto,
  ) {
    return { data: await this.foldersService.create(user, id, dto) };
  }
}
