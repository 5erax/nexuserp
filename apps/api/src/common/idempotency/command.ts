import type { Prisma } from '../../generated/prisma/client';

export type CommandIdentity = {
  organizationId: string;
  actorId: string;
  command: string;
  key: string;
  version: string;
};

export class IdempotentCommand<T extends Prisma.JsonValue> {
  constructor(
    readonly input: unknown,
    readonly authorize: (tx: Prisma.TransactionClient) => Promise<void>,
    readonly run: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {}
}
