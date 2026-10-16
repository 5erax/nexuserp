import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ENVIRONMENT, type Environment } from '../../../config/environment';
import { OUTBOX_HANDLERS, type OutboxHandler, type OutboxMessage } from './handler';

type Claimed = OutboxMessage & { attempts: number; status: string; lockToken: string | null };

@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly handlers: Map<string, OutboxHandler>;
  private timer?: NodeJS.Timeout;
  private stopping = false;
  private running: Promise<void> = Promise.resolve();
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OUTBOX_HANDLERS) handlers: OutboxHandler[],
    @Inject(ENVIRONMENT) private readonly config: Environment,
  ) {
    this.handlers = new Map(handlers.map((handler) => [handler.eventType, handler]));
    if (this.handlers.size !== handlers.length)
      throw new Error('Duplicate outbox handler registration');
  }
  onApplicationBootstrap() {
    if (this.config.NODE_ENV !== 'test') this.running = this.tick();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
  private async tick() {
    try {
      await this.dispatchOnce();
    } catch {
      this.logger.error({ code: 'OUTBOX_POLL_FAILED' });
    } finally {
      if (!this.stopping)
        this.timer = setTimeout(() => {
          this.running = this.tick();
        }, 1000).unref();
    }
  }
  async dispatchOnce() {
    const token = randomUUID();
    // Claim commits before invoking any handler; the materialized candidate set stays bounded.
    // shortcut: fixed 60-second lease; add renewal before registering slow handlers.
    const messages = await this.prisma.$queryRaw<Claimed[]>`WITH candidates AS MATERIALIZED (
      SELECT id FROM outbox_events WHERE published_at IS NULL AND
        ((status = 'PENDING' AND available_at <= clock_timestamp()) OR (status = 'PROCESSING' AND locked_until <= clock_timestamp()))
      ORDER BY available_at,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE outbox_events e SET
      status = CASE WHEN e.attempts >= 5 THEN 'DEAD' ELSE 'PROCESSING' END,
      attempts = CASE WHEN e.attempts >= 5 THEN e.attempts ELSE e.attempts + 1 END,
      locked_until = CASE WHEN e.attempts >= 5 THEN NULL ELSE clock_timestamp() + interval '60 seconds' END,
      lock_token = CASE WHEN e.attempts >= 5 THEN NULL ELSE ${token}::uuid END,
      last_error = CASE WHEN e.attempts >= 5 THEN 'OUTBOX_ATTEMPTS_EXHAUSTED' ELSE e.last_error END
      FROM candidates c WHERE e.id = c.id
      RETURNING e.id,e.organization_id AS "organizationId",e.event_type AS "eventType",e.aggregate_id AS "aggregateId",e.payload,e.attempts,e.status,e.lock_token AS "lockToken"`;
    for (const message of messages) {
      if (message.status === 'DEAD') {
        this.logger.error({ code: 'OUTBOX_ATTEMPTS_EXHAUSTED', eventId: message.id });
        continue;
      }
      const handler = this.handlers.get(message.eventType);
      try {
        if (!handler) throw new Error('Handler not registered');
        await handler.handle(message);
        await this.prisma
          .$executeRaw`UPDATE outbox_events SET status = 'PUBLISHED',published_at = clock_timestamp(),locked_until = NULL,lock_token = NULL,last_error = NULL WHERE id = ${message.id}::uuid AND organization_id = ${message.organizationId}::uuid AND status = 'PROCESSING' AND lock_token = ${message.lockToken}::uuid`;
      } catch {
        const code = handler ? 'OUTBOX_HANDLER_FAILED' : 'OUTBOX_HANDLER_NOT_REGISTERED';
        const delay = 2 ** (message.attempts - 1);
        await this.prisma
          .$executeRaw`UPDATE outbox_events SET status = CASE WHEN attempts >= 5 THEN 'DEAD' ELSE 'PENDING' END,available_at = clock_timestamp() + ${delay} * interval '1 second',locked_until = NULL,lock_token = NULL,last_error = ${code} WHERE id = ${message.id}::uuid AND organization_id = ${message.organizationId}::uuid AND status = 'PROCESSING' AND lock_token = ${message.lockToken}::uuid`;
        this.logger.error({
          code,
          eventId: message.id,
          eventType: message.eventType,
          attempts: message.attempts,
        });
      }
    }
    return messages.length;
  }
}
