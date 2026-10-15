import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';

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
