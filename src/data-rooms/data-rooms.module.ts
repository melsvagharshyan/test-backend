import { Module } from '@nestjs/common';
import { DataRoomsController } from './data-rooms.controller';
import { DataRoomsService } from './data-rooms.service';
import { AccessModule } from '../access/access.module';
import { FoldersModule } from '../folders/folders.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [AccessModule, FoldersModule, FilesModule],
  controllers: [DataRoomsController],
  providers: [DataRoomsService],
})
export class DataRoomsModule {}
