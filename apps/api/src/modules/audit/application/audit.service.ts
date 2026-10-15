import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { scopeFilter, type Actor } from '../../iam/application/access-scope';
import { ListResult } from '../../../common/pagination';
import { z } from 'zod';

export function redactAudit(value: Prisma.InputJsonValue, depth = 0): Prisma.InputJsonValue {
  if (depth > 8) return '[TRUNCATED]';
  if (Array.isArray(value))
    return value.map((item) => (item === null ? null : redactAudit(item, depth + 1)));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /password|token|secret|authorization|cookie|hash/i.test(key)
        ? '[REDACTED]'
        : item == null
          ? null
          : redactAudit(item as Prisma.InputJsonValue, depth + 1),
    ]),
  );
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  async list(
    actor: Actor,
    query: {
      limit: number;
      cursor?: string;
      actorId?: string;
      entityType?: string;
      entityId?: string;
      branchId?: string;
      from?: string;
      to?: string;
    },
  ) {
    let cursor: { id: string; createdAt: string } | undefined;
    if (query.cursor)
      try {
        if (!/^[A-Za-z0-9_-]{1,256}$/.test(query.cursor)) throw new Error('shape');
        cursor = z
          .object({ id: z.string().uuid(), createdAt: z.string().datetime() })
          .parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new BadRequestException('Cursor không hợp lệ');
      }
    if (query.from && query.to && new Date(query.from) > new Date(query.to))
      throw new BadRequestException('Khoảng thời gian không hợp lệ');
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        scopeFilter(actor, 'audit.logs.read'),
        ...(query.actorId ? [{ actorId: query.actorId }] : []),
        ...(query.entityType ? [{ entityType: query.entityType }] : []),
        ...(query.entityId ? [{ entityId: query.entityId }] : []),
        ...(query.branchId ? [{ branchId: query.branchId }] : []),
        ...(query.from || query.to
          ? [
              {
                createdAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              },
            ]
          : []),
        ...(cursor
          ? [
              {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit).map((row) => ({
      id: row.id,
      branchId: row.branchId,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      requestId: row.requestId,
      changes: row.changes,
      createdAt: row.createdAt.toISOString(),
    }));
    const last = items.at(-1);
    return new ListResult(items, {
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt })).toString(
              'base64url',
            )
          : null,
    });
  }
  record(
    tx: Prisma.TransactionClient,
    input: {
      organizationId: string;
      branchId?: string | null;
      actorId?: string | null;
      action: string;
      entityType: string;
      entityId?: string;
      requestId: string;
      ip?: string;
      userAgent?: string;
      changes?: Prisma.InputJsonValue;
    },
  ) {
    return tx.auditLog.create({ data: { ...input, changes: redactAudit(input.changes ?? {}) } });
  }
}
