# Cấu hình môi trường

Không commit `.env`. File `*.example` là mẫu local, không dùng credential này cho production.

| Biến | Nơi dùng | Mặc định / quy tắc |
| --- | --- | --- |
| `DATABASE_URL` | API, Prisma CLI | Bắt buộc, URL `postgresql://` hoặc `postgres://`; không log giá trị |
| `TEST_DATABASE_URL` | Test tích hợp | Bắt buộc, tên database kết thúc `_test`; không fallback sang database ứng dụng |
| `API_PORT` | API | 3001; số nguyên 1–65535 |
| `NODE_ENV` | API/web | development/test/production; Swagger chỉ bật ở development |
| `WEB_ORIGIN` | API | `http://localhost:3000`; dành cho kiểm soát Origin ở Phase 1, chưa phải CSRF đã triển khai |
| `API_INTERNAL_URL` | Web server | `http://127.0.0.1:3001`; origin server-side dùng cho rewrite, không phải biến `NEXT_PUBLIC_*` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker Compose | Local user, password và database; password bắt buộc qua `.env` |
| `POSTGRES_PORT` | Docker host | 5432, chỉ bind loopback |
| `E2E_BASE_URL` | Playwright | `http://127.0.0.1:3000` |

API đọc `.env` trong `apps/api` khi chạy từ script workspace; biến môi trường có sẵn được ưu tiên. Web đọc `.env` trong `apps/web`. Root `.env` chỉ dành cho Compose. Không đặt secret vào `NEXT_PUBLIC_*`.

Turbo chuyển các biến dev qua `passThroughEnv`. Build web đưa `API_INTERNAL_URL` vào cache key; đổi giá trị phải build lại. Không cache integration/concurrency test. CI dùng PostgreSQL riêng và credential dùng một lần trong runner.
