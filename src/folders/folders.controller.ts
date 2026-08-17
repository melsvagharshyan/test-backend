import { Body, Controller, Delete, Get, Param, Patch } from '@nestjs/common';
import { FoldersService } from './folders.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RenameDto } from '../common/dto';

@Controller('folders')
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  @Get(':id/delete-preview')
  async deletePreview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.foldersService.deletePreview(user, id) };
  }

  @Patch(':id')
  async rename(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RenameDto,
  ) {
    return { data: await this.foldersService.rename(user, id, dto) };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return { data: await this.foldersService.remove(user, id) };
  }
}
