import type { Prisma } from '../../../generated/prisma/client';

export const OUTBOX_HANDLERS = Symbol('OUTBOX_HANDLERS');
export type OutboxMessage = {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
};
export interface OutboxHandler {
  readonly eventType: string;
  handle(message: OutboxMessage): Promise<void>;
}
