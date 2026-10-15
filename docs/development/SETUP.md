# Chạy NexusERP cục bộ

Yêu cầu: Node 22.12 trở lên trong nhánh 22 (xem `.nvmrc`), pnpm 10.32.1, PostgreSQL 17 hoặc Docker Compose v2. Chưa có đăng nhập hay dữ liệu nghiệp vụ ở Phase 0.

## Cài dependency

```sh
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install --frozen-lockfile
pnpm db:generate
```

Nếu Node không kèm Corepack, cài Corepack tương thích Node 22 trước. Dùng đúng một `pnpm-lock.yaml`; không chạy npm install trong repo. Install chỉ cho phép build scripts đã liệt kê trong `pnpm-workspace.yaml`; script telemetry của Scarf được giữ tắt.

## Cách 1 — PostgreSQL trong Docker, ứng dụng chạy trên máy

Sao chép `.env.example` → `.env`, `apps/api/.env.example` → `apps/api/.env`, `apps/web/.env.example` → `apps/web/.env`. Trên PowerShell dùng `Copy-Item`; trên macOS/Linux dùng `cp`.

Mật khẩu trong file example chỉ dành cho local; nếu đổi phải đồng bộ `DATABASE_URL`, `TEST_DATABASE_URL` và `COMPOSE_DATABASE_URL`. `POSTGRES_PASSWORD` giữ mật khẩu thô; URL-encode credential khi đưa vào URL. Ví dụ mật khẩu thô `local#test?%` trở thành `local%23test%3F%25` trong URL. URL Compose dùng host `postgres:5432`; URL trên máy dùng `127.0.0.1` và cổng host.

```sh
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: [http://localhost:3000](http://localhost:3000).
- API: [http://localhost:3001/api/v1/health](http://localhost:3001/api/v1/health).
- Swagger ở development: [http://localhost:3001/api/docs](http://localhost:3001/api/docs).
- Web gọi `/api/v1/health/ready` qua proxy cùng origin; response thành công chứng minh web → API → PostgreSQL.

Đã có PostgreSQL riêng thì bỏ lệnh Docker, tạo database `nexuserp` và `nexuserp_test`, sửa hai URL trong `apps/api/.env`. Không trỏ database test vào dữ liệu thật.

## Cách 2 — Toàn bộ stack trong Docker

Chỉ cần file `.env` ở gốc và Docker Compose:

```sh
docker compose --profile app up --build -d
docker compose --profile app logs -f
```

Profile `app` build image production, migrate trước API, chờ readiness trước khi chạy web. API không mở port ra host; truy cập qua web tại `localhost:3000`. API/web chạy bằng user `node`, không phải root. Migration chạy ở container riêng có công cụ CLI; image API chỉ giữ bản deploy production.

```sh
docker compose --profile dev up --build
```

Profile `dev` dùng hot reload cho API source, web app/messages và shared UI. Khi sửa manifest/package dependency, build lại image. Chỉ chạy một profile tại một thời điểm vì cùng dùng cổng 3000. Source mount không ghi đè `node_modules` Linux bằng dependency Windows.

`docker compose --profile app down` dừng container và giữ volume database. `docker compose --profile app down -v` **xóa dữ liệu local**; chỉ dùng khi chủ động reset demo/test. Script khởi tạo database test chỉ chạy khi volume mới; nếu volume đã có từ trước, tạo `nexuserp_test` thủ công.

## Kiểm chứng trước khi mở PR

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm db:check
pnpm contracts:check
pnpm audit:production
pnpm build
```

`test:integration` bắt buộc URL database kết thúc bằng `_test`, tự migrate database đó rồi chạy test với dữ liệu UUID riêng và dọn đúng dữ liệu do test tạo. Không reset toàn bộ schema.

Sau khi API/web đang chạy (dev hoặc production):

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

Ba smoke test kiểm tra proxy tới PostgreSQL, axe accessibility, retry bằng bàn phím và màn hình 390px. Chúng kiểm chứng nền tảng, chưa kiểm chứng nghiệp vụ IAM/Sales/Inventory.

## Xử lý lỗi thường gặp

- API báo thiếu `DATABASE_URL`: tạo `apps/api/.env` hoặc cung cấp biến môi trường. Không có URL mặc định ngầm.
- Readiness 503: kiểm tra PostgreSQL, URL, migration và log theo `requestId`; liveness vẫn chạy khi database hỏng.
- Web chưa kết nối: `API_INTERNAL_URL` phải trỏ tới API có thể truy cập từ tiến trình web. Khi chạy production, rewrite được chốt lúc build; đổi origin phải build lại.
- `ERR_PNPM_UNSUPPORTED_ENGINE`: chuyển sang Node 22 và pnpm 10.32.1, không tắt engine check.
- Dependency có cảnh báo audit: đọc [DEPENDENCIES](DEPENDENCIES.md), không chạy `audit fix --force`.
