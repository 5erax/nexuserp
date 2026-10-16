import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { PasswordService } from '../src/modules/iam/application/password.service';

describe('Phase 2 to Sales migration preflight on owned PostgreSQL schemas', () => {
  it.each(['ACTIVE', 'RELEASED'] as const)(
    'preserves legacy %s reservations without rewriting their history',
    async (status) => {
      const databaseUrl = process.env.TEST_DATABASE_URL;
      if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
        throw new Error('Explicit _test database required');
      const schema = 'migration_' + randomUUID().replaceAll('-', '');
      if (!/^migration_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected owned schema');
      const client = new Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
      });
      await client.connect();
      let created = false;
      try {
        const database = await client.query<{ name: string }>('SELECT current_database() AS name');
        if (!database.rows[0]?.name.endsWith('_test'))
          throw new Error('Owned migration fixtures require _test database');
        await client.query(`CREATE SCHEMA "${schema}"`);
        created = true;
        await client.query(`SET search_path TO "${schema}"`);
        const directory = join(__dirname, '../prisma/migrations');
        const migration = '20261016040000_crm_sales';
        for (const name of readdirSync(directory)
          .filter((name) => /^\d/.test(name) && name < migration)
          .sort())
          await client.query(readFileSync(join(directory, name, 'migration.sql'), 'utf8'));
        const org = randomUUID(),
          branch = randomUUID(),
          actor = randomUUID(),
          product = randomUUID(),
          variant = randomUUID(),
          warehouse = randomUUID(),
          balance = randomUUID(),
          reservation = randomUUID();
        await client.query(
          "INSERT INTO organizations(id,code,name,updated_at) VALUES($1,'LEGACY','Legacy fixture',CURRENT_TIMESTAMP)",
          [org],
        );
        await client.query(
          "INSERT INTO branches(id,organization_id,code,name,updated_at) VALUES($1,$2,'MAIN','Main',CURRENT_TIMESTAMP)",
          [branch, org],
        );
        await client.query(
          "INSERT INTO users(id,organization_id,email,display_name,password_hash,updated_at) VALUES($1,$2,'fixture@example.test','Fixture',$3,CURRENT_TIMESTAMP)",
          [actor, org, await new PasswordService().hash('synthetic-migration-password')],
        );
        await client.query(
          "INSERT INTO products(id,organization_id,name,updated_at) VALUES($1,$2,'Fixture',CURRENT_TIMESTAMP)",
          [product, org],
        );
        await client.query(
          "INSERT INTO product_variants(id,organization_id,product_id,sku,name,selling_price,updated_at) VALUES($1,$2,$3,'LEGACY-SKU','Fixture',1,CURRENT_TIMESTAMP)",
          [variant, org, product],
        );
        await client.query(
          "INSERT INTO warehouses(id,organization_id,branch_id,code,name,updated_at) VALUES($1,$2,$3,'MAIN','Main',CURRENT_TIMESTAMP)",
          [warehouse, org, branch],
        );
        await client.query(
          'INSERT INTO stock_balances(id,organization_id,warehouse_id,variant_id,on_hand,reserved,updated_at) VALUES($1,$2,$3,$4,1,$5,CURRENT_TIMESTAMP)',
          [balance, org, warehouse, variant, status === 'ACTIVE' ? '1' : '0'],
        );
        await client.query(
          'INSERT INTO stock_reservations(id,organization_id,balance_id,reference_id,quantity,status,updated_at) VALUES($1,$2,$3,$4,1,$5,CURRENT_TIMESTAMP)',
          [reservation, org, balance, randomUUID(), status],
        );
        const sql = readFileSync(join(directory, migration, 'migration.sql'), 'utf8');
        if (status === 'ACTIVE') {
          await expect(client.query(sql)).rejects.toThrow(
            'Release Phase 2 ACTIVE reservations through Inventory',
          );
          await client.query('ROLLBACK');
          expect(
            (await client.query("SELECT to_regclass('customers') AS name")).rows[0].name,
          ).toBeNull();
          expect(
            (
              await client.query(
                "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='stock_reservations' AND column_name='order_item_id'",
                [schema],
              )
            ).rows[0].count,
          ).toBe(0);
          expect(
            (await client.query('SELECT reserved::text FROM stock_balances WHERE id=$1', [balance]))
              .rows[0].reserved,
          ).toBe('1.000');
        } else {
          await client.query(sql);
          const row = (
            await client.query(
              'SELECT status,order_item_id,quantity::text FROM stock_reservations WHERE id=$1',
              [reservation],
            )
          ).rows[0];
          expect(row).toEqual({ status: 'RELEASED', order_item_id: null, quantity: '1.000' });
        }
      } finally {
        await client.query('ROLLBACK');
        if (created) {
          await client.query('SET search_path TO public');
          await client.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
        await client.end();
      }
    },
  );
});
