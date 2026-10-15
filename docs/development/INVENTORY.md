# Inventory application services

## Stock ledger (#49)

`InventoryModule` exports `StockLedgerService`. `post(tx, input)` takes the caller's Prisma interactive transaction: an `IdempotentCommand` runs it with the document write and audit in the same transaction. Propagate posting failures so the entire command rolls back. Passing the root Prisma client is rejected; the service never starts a separate transaction. This follows the [Prisma transaction contract](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

Only this service creates stock balances, changes `onHand` or appends movements. Balance creation uses `INSERT ... ON CONFLICT DO NOTHING`, then a conditional atomic update increments `onHand` and `version`. Movement insertion shares the transaction; a duplicate reference or duplicate opening returns `MOVEMENT_ALREADY_POSTED` (409) and rolls back the increment. Callers must keep stable document references even after the idempotency cache expires.

Inputs use exact decimal strings, at most 15 integer and 3 fractional quantity digits. `OPENING` and `ADJUSTMENT_IN` require a positive delta; `ADJUSTMENT_OUT` and `SHIPMENT_OUT` require a negative delta. Inbound `unitCost` is optional/null or nonnegative with at most 14 integer and 6 fractional digits; outbound cost stays null. Invalid inputs fail before SQL can silently round them. A positive balance overflow returns `STOCK_LIMIT_EXCEEDED` (409).

Outbound updates require the resulting `onHand >= reserved`; insufficient available stock returns `INSUFFICIENT_STOCK` (409), with exact `variantId`, `requested` and `available` strings. Reservations do not change on-hand; shipment consumption must release the matching reserved quantity and post its outbound movement within one caller transaction (#50).

The service has no public HTTP endpoint. The caller owns permission/branch checks and document lifecycle rules; composite foreign keys still reject cross-organization references. Opening/adjustment authorization and approval arrive in #51, and scoped warehouse/read APIs in #53. Archived products are not a blanket prohibition here: existing stock still needs controlled correction/depletion.

`stock-ledger.integration-spec.ts` checks exact decimals, all four movement types, insufficient available stock, concurrent first receipts and last-unit outbound races, duplicate references/openings, foreign references, immutable history, idempotent replay and full caller rollback. `stock-ownership.spec.ts` guards explicit Prisma/SQL writes outside the ledger while allowing reservation-only balance updates. Tests clean only UUID-owned fixtures in an explicit `_test` database.
