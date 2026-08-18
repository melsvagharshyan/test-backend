import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { normalizeDatabaseUrl } from '../common/utils/database-url';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const connectionString = normalizeDatabaseUrl(
      config.getOrThrow<string>('DATABASE_URL'),
    );
    const adapter = new PrismaPg({
      connectionString,
      ssl: connectionString.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
    });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
