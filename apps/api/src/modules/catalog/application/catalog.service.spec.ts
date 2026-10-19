import type { Product } from '../../../generated/prisma/client';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditService } from '../../audit/application/audit.service';
import type { Actor } from '../../iam/application/access-scope';
import type { AuthService } from '../../iam/application/auth.service';
import { CatalogService } from './catalog.service';

describe('Product audit payload bounds', () => {
  const actor = {
    id: 'actor',
    organizationId: 'organization',
    familyId: 'family',
    mustChangePassword: false,
    grants: { 'catalog.products.manage': ['ORG'] },
  } as unknown as Actor;
  function fixture() {
    const row: Product = {
      id: 'product',
      organizationId: actor.organizationId,
      name: 'Product',
      category: null,
      description: String.fromCharCode(1).repeat(2000),
      status: 'ACTIVE',
      createdAt: new Date('2026-10-19T00:00:00Z'),
      updatedAt: new Date('2026-10-19T00:00:00Z'),
    };
    const records: { action: string; changes: unknown; requestId: string }[] = [];
    const tx = {
      $queryRaw: async () => [],
      product: {
        findFirst: async () => row,
        update: async ({ data }: { data: Partial<Product> }) => ({ ...row, ...data }),
      },
      auditLog: {
        create: async ({ data }: { data: (typeof records)[number] }) => {
          // Pretty JSON is a conservative bound for PostgreSQL jsonb's added whitespace.
          if (Buffer.byteLength(JSON.stringify(data.changes, null, 1)) > 16384)
            throw new Error('audit_changes_size');
          records.push(data);
          return data;
        },
      },
    };
    const prisma = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) };
    const service = new CatalogService(
      prisma as unknown as PrismaService,
      { actorForFamily: async () => actor } as unknown as AuthService,
      new AuditService(prisma as unknown as PrismaService),
    );
    return { service, records, row };
  }
  it('renames and archives a product without repeating its unchanged long description', async () => {
    const { service, records, row } = fixture();
    const result = await service.update(
      actor,
      row.id,
      { name: 'Renamed', status: 'INACTIVE' },
      { requestId: 'rename' },
    );
    expect(result).toMatchObject({ name: 'Renamed', description: row.description });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: 'catalog.product_archived', requestId: 'rename' });
  });
  it.each([String.fromCharCode(2).repeat(2000), null])(
    'retains each side of a description change within the audit limit',
    async (description) => {
      const { service, records, row } = fixture();
      await service.update(actor, row.id, { description }, { requestId: 'description' });
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ changes: { before: { description: row.description } } }),
          expect.objectContaining({ changes: { after: { description } } }),
        ]),
      );
      expect(records.every((record) => record.requestId === 'description')).toBe(true);
    },
  );
});
