# Inventory application services

## Stock ledger (#49)

`InventoryModule` exports `StockLedgerService`. `post(tx, input)` takes the caller's Prisma interactive transaction: an `IdempotentCommand` runs it with the document write and audit in the same transaction. Propagate posting failures so the entire command rolls back. Passing the root Prisma client is rejected; the service never starts a separate transaction. This follows the [Prisma transaction contract](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

Only this service creates stock balances, changes `onHand` or appends movements. Balance creation uses `INSERT ... ON CONFLICT DO NOTHING`, then a conditional atomic update increments `onHand` and `version`. Movement insertion shares the transaction; a duplicate reference or duplicate opening returns `MOVEMENT_ALREADY_POSTED` (409) and rolls back the increment. Callers must keep stable document references even after the idempotency cache expires.

Inputs use exact decimal strings, at most 15 integer and 3 fractional quantity digits. `OPENING` and `ADJUSTMENT_IN` require a positive delta; `ADJUSTMENT_OUT` and `SHIPMENT_OUT` require a negative delta. Inbound `unitCost` is optional/null or nonnegative with at most 14 integer and 6 fractional digits; outbound cost stays null. Invalid inputs fail before SQL can silently round them. A positive balance overflow returns `STOCK_LIMIT_EXCEEDED` (409).

Outbound updates require the resulting `onHand >= reserved`; insufficient available stock returns `INSUFFICIENT_STOCK` (409), with exact `variantId`, `requested` and `available` strings. Reservations do not change on-hand; shipment consumption must release the matching reserved quantity and post its outbound movement within one caller transaction (#50).

The service has no public HTTP endpoint. The caller owns permission/branch checks and document lifecycle rules; composite foreign keys still reject cross-organization references. Opening/adjustment authorization and approval arrive in #51, and scoped warehouse/read APIs in #53. Archived products are not a blanket prohibition here: existing stock still needs controlled correction/depletion.

`stock-ledger.integration-spec.ts` checks exact decimals, all four movement types, insufficient available stock, concurrent first receipts and last-unit outbound races, duplicate references/openings, foreign references, immutable history, idempotent replay and full caller rollback. `stock-ownership.spec.ts` guards explicit Prisma/SQL writes outside the ledger while allowing reservation-only balance updates. Tests clean only UUID-owned fixtures in an explicit `_test` database.

## Reservations (#50)

`InventoryModule` also exports `ReservationsService`: `reserve(tx, {organizationId, warehouseId, referenceId, items})`, `release(tx, selection)` and `consume(tx, {...selection, createdBy, shipmentId})`. The same reference identifies the whole reservation batch (1–100 unique variants), not one line; references cannot be reused after release/consumption. Phase 2 has no public reservation endpoint or Sales FK. Callers validate the warehouse/branch and business document, propagate errors, and commit the document/audit with Inventory changes in one transaction.

A transaction advisory lock on organization/reference serializes duplicate reserve commands and competing release/consume commands. UUID case is normalized for the lock and variant lookup. Balances are then locked in ascending immutable balance ID order, independently of input line order. Conditional updates enforce `onHand - reserved >= quantity` before incrementing reserved; a missing balance means zero available. Failure of any line aborts the entire command. The `(organizationId, referenceId)` index supports batch lookup without scanning the organization's reservation history.

Release changes ACTIVE reservations to RELEASED and subtracts reserved. Consume changes them to CONSUMED, subtracts reserved and calls the ledger for each negative SHIPMENT_OUT movement with the stable shipment ID. Both are terminal transitions; repeated or mixed terminal requests return `RESERVATION_NOT_ACTIVE` (409) without another balance change. `STOCK_BALANCE_MISMATCH` (409) stops consumption/release if the aggregate reserved quantity is corrupt; investigate/repair with approved documents rather than clamping a balance. Each balance mutation increments version; consume increments it for both reserved and on-hand changes.

Command transactions use `withTransactionRetry` through the idempotency framework: READ COMMITTED plus explicit locks/conditional updates. Only a confirmed PostgreSQL deadlock/serialization abort (Prisma P2034, or P2010 with the pinned pg adapter's TransactionWriteConflict cause) retries the entire callback, at most three attempts with 10/20ms backoff. It rechecks authorization, reclaims idempotency and repeats all database changes after rollback. Exhaustion returns TRANSACTION_CONFLICT (409); timeouts, lost connections and business failures are not automatically retried. Callbacks must contain database operations only, without irreversible network side effects. See [PostgreSQL deadlocks](https://www.postgresql.org/docs/17/explicit-locking.html#LOCKING-DEADLOCKS).

`reservations.integration-spec.ts` verifies all-or-nothing, exact decimals, duplicate/terminal protection, last-unit contention, reverse SKU ordering, organization isolation, shipment rollback, an actual two-connection deadlock, serialization rollback and bounded retry. The idempotency suite also verifies a retried aborted command leaves one key and one business write. `stock-concurrency.integration-spec.ts` adds 20 rounds of 100 contenders, reverse SKU commands and 100 concurrent retries, with reconciliation after each stage; see the [test strategy](../testing/TEST_STRATEGY.md#inventory-concurrency-54) for commands and mutation evidence.

## Reconciliation (#52)

`GET /api/v1/inventory/reconciliation` requires `inventory.balances.read` with ORG scope. This is the explicit organization-wide inventory administration grant; role names do not bypass it, and BRANCH grants receive 403. The organization always comes from the authenticated actor. Query parameters are `page` (default 1), `pageSize` (default 20, maximum 100) and optional `warehouseId`; a foreign/missing warehouse returns 404. Active and archived warehouses/SKUs are included because their history still matters.

Each result identifies warehouse, branch and SKU, with exact three-decimal strings `onHand`, `expectedOnHand` (sum of all movements), `reserved` and `expectedReserved` (sum of ACTIVE reservations). It also flags `missingBalance`. A full join detects ledger history missing its aggregate row and nonzero balances without ledger entries; absent aggregate sums are zero. Count and page use one REPEATABLE READ snapshot to avoid false drift/page-count differences during concurrent posting. Results are sorted by warehouse/variant UUID for stable paging. The endpoint only reports differences and never changes balances or history.

Maintenance CLI (requires a privileged database connection, bypasses HTTP/session authentication):

```sh
pnpm --filter @nexus/api inventory:reconcile <organization-uuid> [page]
```

It returns JSON for one page of at most 100 differences and a total count. Exit 0 means no differences in the organization; exit 2 means differences exist even if the requested page is empty; exit 1 means invalid arguments, missing organization or a configuration/database failure. Request further pages when total exceeds 100; each request/CLI page takes its own snapshot. `ReconciliationService.check` is the trusted maintenance/test interface; HTTP callers use the permission-checked `list` method.

When drift appears, record the organization/warehouse/SKU, actual/expected values and requestId, then pause posting for that warehouse while investigating. Check immutable movement references, document status, active reservations and transaction/error logs. Do not overwrite `onHand`/`reserved`, delete history, or treat a read report as permission to repair. Corrections require the approved document workflow (#51) and a reviewed cause-specific repair if an aggregate/reservation is corrupt. Re-run reconciliation after the controlled repair and resume writes only when the cause and result are verified.

`reconciliation.integration-spec.ts` exercises HTTP/CLI exit codes, both kinds of drift, missing balance/ledger cases, pagination, exact decimals, current grant changes and cross-organization isolation. Corruption is introduced only into UUID-owned test fixtures and restored/cleaned there; production code remains read-only.
