# Kiến trúc nền tảng đang chạy

```mermaid
flowchart LR
    browser[Browser] --> web[Next.js web]
    web -->|/api/v1 rewrite cùng origin| api[NestJS API]
    api --> prisma[Prisma + pg adapter]
    prisma --> db[(PostgreSQL 17)]
```

Web dùng App Router, TanStack Query, shared UI tokens và client từ OpenAPI. NestJS đặt global prefix `/api/v1`, validation nghiêm ngặt, requestId, envelope, exception filter và log JSON đã giới hạn trường. IAM có auth cookie/CSRF, JWT kiểm tra family/user mỗi request và guard mặc định từ chối; mọi route phải có metadata công khai, session hoặc permission. Audit cùng transaction và trigger append-only. Giao diện auth và endpoint quản trị ở các task tiếp theo.

Liveness `/health` không cần database. Readiness `/health/ready` chạy `SELECT 1` trên PostgreSQL qua HealthService và Prisma, trả 503 không lộ credential khi mất kết nối. API được phép khởi chạy khi database tạm hỏng, nhưng thiếu/sai cấu hình phải fail ngay.

OpenAPI sinh từ Nest decorators qua `pnpm contracts:generate`; `packages/contracts` giữ schema TypeScript sinh tự động và factory typed client. CI tái sinh rồi kiểm tra drift. Quy ước pagination/idempotency ở [API_CONVENTIONS](../api/API_CONVENTIONS.md); framework command idempotency được triển khai tại #47.

Docker dùng migration job riêng, API/web image chạy user không phải root, PostgreSQL volume bền vững. Redis/BullMQ, metrics và cách ly tenant đầy đủ chưa thuộc Phase 0.
