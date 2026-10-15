import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
@Injectable()
export class OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}
  create(input: { code: string; name: string }) {
    return this.prisma.organization.create({ data: input });
  }
  findById(id: string) {
    return this.prisma.organization.findUnique({ where: { id } });
  }
}
