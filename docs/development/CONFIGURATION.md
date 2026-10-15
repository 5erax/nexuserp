# Cấu hình môi trường

Không commit `.env`. File `*.example` là mẫu local, không dùng credential này cho production.

| Biến | Nơi dùng | Mặc định / quy tắc |
| --- | --- | --- |
| `DATABASE_URL` | API, Prisma CLI | Bắt buộc, URL `postgresql://` hoặc `postgres://`; không log giá trị |
| `TEST_DATABASE_URL` | Test tích hợp | Bắt buộc, tên database kết thúc `_test`; không fallback sang database ứng dụng |
| `API_PORT` | API | 3001; số nguyên 1–65535 |
| `NODE_ENV` | API/web | development/test/production; Swagger chỉ bật ở development |
| `WEB_ORIGIN` | API | Origin chính xác, không path/trailing slash; local `http://localhost:3000`, production bắt buộc HTTPS; kiểm tra mọi unsafe request |
| `JWT_SECRET` / `CSRF_SECRET` | API | Bắt buộc 32–256 ký tự, hai secret khác nhau, tạo ngẫu nhiên ít nhất 32 byte; production từ chối giá trị placeholder example |
| `API_RATE_LIMIT` | API | 300 request/phút/IP mặc định; login thêm 10 lần/15 phút/IP và organization/email, refresh/bootstrap thêm 60/phút/IP |
| `TRUSTED_PROXY_IP` | API | Optional; chỉ nhận một IP hợp lệ của ingress kiểm soát được. Compose dùng 172.29.241.10; không tin header từ địa chỉ khác |
| `API_INTERNAL_URL` | Web server | `http://127.0.0.1:3001`; origin server-side dùng cho rewrite, không phải biến `NEXT_PUBLIC_*` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Docker Compose | Local user, password và database; password bắt buộc qua `.env` |
| `POSTGRES_PORT` | Docker host | 5432, chỉ bind loopback |
| `COMPOSE_DATABASE_URL` | Compose migration/API | URL đầy đủ tới host `postgres:5432`; credential percent-encoded, độc lập với mật khẩu thô của PostgreSQL |
| `E2E_BASE_URL` | Playwright | `http://127.0.0.1:3000` |

API đọc `.env` trong `apps/api` khi chạy từ script workspace; biến môi trường có sẵn được ưu tiên. Web đọc `.env` trong `apps/web`. Root `.env` chỉ dành cho Compose. Không đặt secret vào `NEXT_PUBLIC_*`.

Tạo hai secret riêng bằng `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`, lưu vào file `.env` bị ignore hoặc secret manager. Không paste vào issue/PR/log. Production sau TLS proxy, WEB_ORIGIN là origin bên ngoài. Compose ingress Nginx ghi đè X-Forwarded-For bằng socket client, chuyển `/api/` thẳng tới API; API chỉ nhận header một IP từ ingress cố định 172.29.241.10, không tin chuỗi/IP do client gửi qua web rewrite. API/web không mở port production ra host; chỉ ingress bind loopback. Mạng Compose 172.29.241.0/24 dành riêng ingress, pool động ở .128/25. TLS nên kết thúc tại ingress; thêm proxy/CDN phía trước phải cấu hình danh sách proxy tin cậy và kiểm thử lại nguồn IP trước triển khai. Rate limiter process-local, cần shared store trước khi chạy nhiều replica.

JWT HS256 15 phút, pin algorithm/issuer/audience; refresh random 256 bit, SHA-256 lưu DB, family 7 ngày. Argon2id v19, memory 19 MiB, timeCost2, parallelism1, salt random16 byte, output32 byte. Hash yếu hơn được nâng sau login đúng, không hạ tham số mạnh hơn. Tham số dựa [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); đánh giá lại hiệu năng và cập nhật policy trước triển khai dữ liệu thật.

Turbo chuyển các biến dev qua `passThroughEnv`. Build web đưa `API_INTERNAL_URL` vào cache key; đổi giá trị phải build lại. Không cache integration/concurrency test. CI dùng PostgreSQL riêng và credential dùng một lần trong runner.
