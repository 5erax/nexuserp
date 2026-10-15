# NexusERP contributor context

- Read `docs/product/SCOPE.md` and the relevant ADR before changing behavior. Main product language is Vietnamese.
- Node 22.12+ within major 22; pnpm 10.32.1. Use the committed lockfile and frozen install, never npm/yarn lockfiles.
- `pnpm db:generate` creates the ignored Prisma client. API environment is `apps/api/.env`; web environment is `apps/web/.env`.
- Checks: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm db:check`, `pnpm contracts:check`, `pnpm audit:production`, `pnpm build`.
- Integration tests require PostgreSQL and `TEST_DATABASE_URL` ending in `_test`; never reset a shared or production database. See `docs/development/SETUP.md`.
- Presentation must not import Prisma/repositories. Each module owns its writes; other modules use public interfaces. Domain stays free of framework/infrastructure imports.
- Only health/readiness endpoints currently exist. Implement IAM guards and scope checks before exposing business data. Do not add unauthenticated CRUD as a shortcut.
- Money is Decimal; API money uses strings. Inventory ledger and posted documents are immutable. See ADR-0004/0007.
- Regenerate contracts in the same PR as API changes. Do not hand-edit generated schema/client or migrate via db push.
- Never claim a design or test passed without executing its check. Docker runs in CI if unavailable locally; report this limitation.
