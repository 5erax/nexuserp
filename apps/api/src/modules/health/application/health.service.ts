import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}
  async ready() {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'ready' as const };
    } catch {
      throw new ServiceUnavailableException({ code: 'DATABASE_UNAVAILABLE' });
    }
  }
}
