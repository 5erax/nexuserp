import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ENVIRONMENT, type Environment } from '../../config/environment';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENVIRONMENT) config: Environment) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        max: 10,
      }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
