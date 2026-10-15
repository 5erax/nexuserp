import { Global, Module } from '@nestjs/common';
import { ENVIRONMENT, parseEnvironment } from '../../config/environment';
import { PrismaService } from './prisma.service';
@Global()
@Module({
  providers: [
    { provide: ENVIRONMENT, useFactory: () => parseEnvironment(process.env) },
    PrismaService,
  ],
  exports: [ENVIRONMENT, PrismaService],
})
export class PrismaModule {}
