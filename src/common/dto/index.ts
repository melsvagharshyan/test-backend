import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class CreateDataRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class UpdateDataRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;
}

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class RenameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;
}

export class MoveFileDto {
  @IsString()
  folderId: string;
}

export class CreateShareDto {
  @IsString()
  resourceType: 'DATA_ROOM' | 'FOLDER' | 'FILE';

  @IsString()
  resourceId: string;

  @IsString()
  kind: 'USER' | 'PUBLIC_LINK';

  @IsOptional()
  @IsEmail()
  recipientEmail?: string;
}

export class ListContentsQueryDto {
  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  q: string;
}
