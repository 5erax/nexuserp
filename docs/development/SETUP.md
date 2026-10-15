# Chạy NexusERP cục bộ

Yêu cầu: Node 22.12 trở lên trong nhánh 22 (xem `.nvmrc`), pnpm 10.32.1, PostgreSQL 17 hoặc Docker Compose v2. API đã có phiên/CSRF; tài khoản bootstrap và giao diện quản trị được bổ sung ở phần IAM tiếp theo.

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

Tạo hai secret JWT/CSRF độc lập theo [CONFIGURATION](CONFIGURATION.md), thay placeholder. Đặt WEB_ORIGIN đúng URL trình duyệt (`localhost` và `127.0.0.1` là hai origin khác nhau). Cookie không có Domain; dùng một origin nhất quán.

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

Profile `app` có Nginx ingress non-root trên cổng host 3000: `/api/` tới API, các trang tới web. Ingress ghi đè header IP; API chỉ tin địa chỉ cố định của ingress để quota từng client không bị gộp thành quota của web container. Native `pnpm dev` vẫn dùng Next rewrite cho máy local; cấu hình proxy demo khác phải kiểm chứng spoof/IP isolation theo CONFIGURATION.

Xác thực của profile production yêu cầu TLS proxy bên ngoài, WEB_ORIGIN HTTPS đúng tên miền và secret đã thay; health vẫn kiểm tra được qua HTTP loopback trong CI. Phát triển đăng nhập local qua profile `dev`/`pnpm dev`, không tắt Secure trong cấu hình production để né HTTPS.

```sh
docker compose --profile dev up --build
```

Profile `dev` dùng hot reload cho API source, web app/messages và shared UI. Khi sửa manifest/package dependency, build lại image. Chỉ chạy một profile tại một thời điểm vì cùng dùng cổng 3000. Source mount không ghi đè `node_modules` Linux bằng dependency Windows.

`docker compose --profile app down` dừng container và giữ volume database. `docker compose --profile app down -v` **xóa dữ liệu local**; chỉ dùng khi chủ động reset demo/test. Script khởi tạo database test chỉ chạy khi volume mới; nếu volume đã có từ trước, tạo `nexuserp_test` thủ công.

## Khởi tạo chủ tài khoản

`pnpm db:seed` chỉ tạo catalog permission/role. Để tạo tổ chức mới và Business Owner đầu tiên, đặt bốn biến môi trường BOOTSTRAP_ORGANIZATION_CODE, BOOTSTRAP_ORGANIZATION_NAME, BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD rồi chạy `pnpm --filter @nexus/api iam:bootstrap`. Mật khẩu 12–128 ký tự, không có mặc định; tránh lưu vào shell history/file được Git theo dõi. Lệnh chỉ tạo mới trong một transaction, từ chối organization code đã tồn tại, không ghi đè tài khoản và chỉ in UUID. Lần login đầu buộc đổi mật khẩu. Mở `/login` qua origin web được cấu hình.

shadcn/ui dùng cấu hình monorepo trong apps/web và packages/ui; Tailwind v4 để trống config. Thêm component từ apps/web bằng `pnpm dlx shadcn@4.21.5 add <component>` rồi kiểm tra dependency được khai báo ở package sở hữu source (shared Input và cn nằm trong packages/ui). Giữ tokens hiện có; không ghi đè CSS toàn app. Tham chiếu [hướng dẫn monorepo](https://ui.shadcn.com/docs/monorepo).

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

Smoke test kiểm tra proxy tới PostgreSQL, axe accessibility, retry bằng bàn phím, màn hình 390px và hiển thị lỗi mạng/requestId. API integration kiểm chứng auth/CSRF/rotation thật; chưa coi UI nghiệp vụ Sales/Inventory đã được kiểm chứng.

Playwright global setup tạo một tổ chức E2E mới bằng CLI bootstrap và mật khẩu ngẫu nhiên trong database mà API đang dùng; không dùng hoặc reset tài khoản có sẵn. Ở local, fixture được giữ cùng audit để không phá tính append-only; chỉ chạy với database phát triển. CI dùng database `_test` tạm, API đã build với NODE_ENV=test cho HTTP loopback, web dùng production build. Secure cookie production được kiểm chứng riêng bởi auth integration. Browser test có login sai/đúng, buộc đổi mật khẩu, refresh hai tab (một request refresh), logout, 429 và axe cho form.

## Xử lý lỗi thường gặp

- API báo thiếu `DATABASE_URL`: tạo `apps/api/.env` hoặc cung cấp biến môi trường. Không có URL mặc định ngầm.
- Readiness 503: kiểm tra PostgreSQL, URL, migration và log theo `requestId`; liveness vẫn chạy khi database hỏng.
- Web chưa kết nối: `API_INTERNAL_URL` phải trỏ tới API có thể truy cập từ tiến trình web. Khi chạy production, rewrite được chốt lúc build; đổi origin phải build lại.
- `ERR_PNPM_UNSUPPORTED_ENGINE`: chuyển sang Node 22 và pnpm 10.32.1, không tắt engine check.
- Dependency có cảnh báo audit: đọc [DEPENDENCIES](DEPENDENCIES.md), không chạy `audit fix --force`.
