import { createHash } from 'node:crypto';
import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IdempotentCommand, type CommandIdentity } from './command';

const conflict = (code: 'IDEMPOTENCY_KEY_REUSED' | 'REQUEST_IN_PROGRESS') =>
  new ConflictException({
    code,
    message:
      code === 'REQUEST_IN_PROGRESS'
        ? 'Yêu cầu đang được xử lý'
        : 'Khóa đã được dùng với nội dung khác',
  });

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

function safeResponse(value: Prisma.JsonValue): Prisma.JsonValue {
  const json = JSON.stringify(value, (key, item: unknown) => {
    if (/password|token|secret|authorization|cookie/i.test(key))
      throw new InternalServerErrorException();
    return item;
  });
  if (!json || Buffer.byteLength(json) > 1048576) throw new InternalServerErrorException();
  return JSON.parse(json) as Prisma.JsonValue;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  execute<T extends Prisma.JsonValue>(
    identity: CommandIdentity,
    command: IdempotentCommand<T>,
    status = 200,
  ): Promise<{ data: T; status: number; replayed: boolean }> {
    const { organizationId, actorId } = identity;
    const key = identity.key.toLowerCase();
    const lock = createHash('sha256')
      .update(canonical([organizationId, actorId, identity.command, key]))
      .digest()
      .readBigInt64BE();
    const requestHash = createHash('sha256')
      .update(canonical({ version: identity.version, input: command.input }))
      .digest('hex');
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(${lock}::bigint) AS locked`;
      if (!row?.locked) throw conflict('REQUEST_IN_PROGRESS');
      await command.authorize(tx);
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const now = clock!.now;
      const where = {
        organizationId_actorId_command_key: {
          organizationId,
          actorId,
          command: identity.command,
          key,
        },
      };
      const existing = await tx.idempotencyKey.findUnique({ where });
      if (existing && existing.expiresAt > now) {
        if (existing.requestHash !== requestHash) throw conflict('IDEMPOTENCY_KEY_REUSED');
        if (existing.status !== 'COMPLETED') throw conflict('REQUEST_IN_PROGRESS');
        return { data: existing.response as T, status: existing.responseStatus!, replayed: true };
      }
      if (existing) await tx.idempotencyKey.deleteMany({ where: { id: existing.id } });
      const claimed = await tx.idempotencyKey.create({
        data: {
          organizationId,
          actorId,
          command: identity.command,
          key,
          requestHash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 86400000),
        },
      });
      const data = safeResponse(await command.run(tx)) as T;
      await tx.idempotencyKey.update({
        where: { id: claimed.id },
        data: {
          status: 'COMPLETED',
          response: data === null ? Prisma.JsonNull : data,
          responseStatus: status,
        },
      });
      return { data, status, replayed: false };
    });
  }
}

export function pruneExpiredKeys(
  prisma: Pick<Prisma.TransactionClient, '$executeRaw'>,
  limit = 100,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Batch limit must be 1–1000');
  return prisma.$executeRaw`
    WITH expired AS MATERIALIZED (
      SELECT id FROM idempotency_keys WHERE expires_at <= clock_timestamp()
      ORDER BY expires_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    DELETE FROM idempotency_keys USING expired WHERE idempotency_keys.id = expired.id`;
}
