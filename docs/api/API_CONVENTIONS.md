# Quy ước REST API v1

API công khai cùng origin với web, prefix `/api/v1`; Nest chỉ nhận traffic từ proxy tin cậy khi triển khai. OpenAPI là contract của endpoint đã triển khai; tài liệu này còn mô tả hành vi đích theo phase, không cam kết endpoint chưa có đã chạy.

## Dữ liệu và response

- JSON camelCase, UUID chuẩn cho ID; DTO từ chối trường lạ. Chuỗi có giới hạn độ dài, mảng tối đa 100 phần tử; request JSON tối đa 1 MiB. Không chấp nhận giá/tổng/status tùy ý từ client.
- Tiền và quantity Decimal trả dưới dạng chuỗi thập phân, không scientific notation. VND nguyên đồng HALF_UP theo ADR-0013; quantity tối đa 3 chữ số thập phân. Timestamp ISO 8601 UTC (`2026-10-15T01:00:00.000Z`); date-only `YYYY-MM-DD` cho kỳ báo cáo theo timezone tổ chức.
- Thành công: `{ "data": ..., "meta": { "requestId": "..." } }`. Danh sách: `data` là array, meta thêm `page`, `pageSize`, `total`. 201 cho create, 200 cho read/update/command có body. Không bọc lần hai tại controller.
- Lỗi: `{ "error": { "code": "...", "message": "...", "details": null, "requestId": "..." } }`. Code ổn định cho client, message tiếng Việt. Validation details chỉ field và lỗi hợp lệ, không echo password/token. 500/503 trả thông báo chung; log có requestId và call site an toàn, không log credential/SQL parameter.
- `X-Request-Id` từ client chỉ nhận `[A-Za-z0-9_-]{1,64}`, còn lại cấp UUID; luôn trả header. Không sử dụng header này làm identity hoặc authorization.

## Query danh sách

MVP chọn offset pagination cho trang quản trị/báo cáo: `page` nguyên 1+, `pageSize` 1–100 mặc định 20. Lọc scope **trước** đếm và pagination. Sort mặc định `createdAt DESC, id DESC`; `sortBy` allowlist theo endpoint, `sortOrder=asc|desc`, luôn thêm ID tie-breaker. `q` trim, tối đa 100 ký tự, chỉ tìm các cột tài liệu hóa; không nhận tên cột/SQL tùy ý. `branchId`, `status`, `from`, `to` được validate; không được dùng filter để mở scope.

Audit/movement timeline dùng cursor để giữ ổn định khi append: `limit` 1–100, cursor opaque chứa `(createdAt,id)` được kiểm tra shape; filter/scope áp lại mỗi lần. Không coi cursor là quyền truy cập. Trả `meta.nextCursor`, bỏ `total` trên timeline. Export tái sử dụng filter/scope của report, không tự lấy toàn tổ chức; giới hạn 10.000 dòng đồng bộ và báo lỗi khi vượt, không cắt im lặng.

## Xác thực và CSRF

Xem ADR-0010 và REFRESH_TOKEN_POLICY. Browser không giữ access/refresh trong storage; dùng cookie HttpOnly, Secure production, SameSite=Lax, host-only. Trước login gọi GET `/auth/csrf`; token trả trong body và cookie readable, gửi `X-CSRF-Token` với mọi request thay đổi trạng thái. Login dùng pre-auth binding, sau login lấy token gắn family. Origin phải trùng WEB_ORIGIN cho unsafe methods. GET không thay đổi nghiệp vụ. Không bật CORS rộng vì proxy cùng origin.

Me/logout không cần business permission; API nghiệp vụ cần cả permission và scope. Thiếu permission →403; ID ngoài scope →404. Refresh có thể hoạt động khi access hết hạn, nhưng vẫn cần Origin/CSRF và refresh cookie. Không áp permission guard access lên refresh.

## Idempotency command (#47)

Mọi POST thay đổi nghiệp vụ catalog/inventory/CRM/Sales/Finance yêu cầu UUID `Idempotency-Key`; auth, read và PATCH quản trị không thuộc cơ chế này. Scope unique `(organizationId, actorId, method, routeTemplate, resourceId, key)`. Lưu SHA-256 của JSON canonical theo DTO đã validate, path resource và version command; thứ tự dòng hàng được giữ. Cùng key/payload trả status/body thành công cũ trong 24 giờ, với requestId của request mới. Khác payload →409 `IDEMPOTENCY_KEY_REUSED`; transaction chưa commit →409 `REQUEST_IN_PROGRESS`, `Retry-After: 1`. Chỉ trả replay sau kiểm tra phiên/permission/scope hiện tại để không lộ response sau khi bị thu quyền.

Khóa idempotency và thay đổi dữ liệu commit cùng transaction, không tạo command đã thành công nhưng thiếu response đã lưu. Timeout/rollback cho phép thử lại. Unique document/movement/reference vẫn bảo vệ sau TTL; key hết hạn không tự làm lại transition terminal. Không lưu cookie, token hoặc mật khẩu trong response cache. Dọn key theo expiry trong batch có giới hạn.

Framework đã có trong `common/idempotency`; các endpoint nghiệp vụ dùng ở task tiếp theo. `@Idempotent()` kiểm tra header UUID và khai báo OpenAPI, chạy sau guard và trước envelope. Controller chỉ trả `IdempotentCommand` do application service tạo, không thực hiện side effect trước đó. Command giữ DTO đã validate, callback authorize chỉ đọc để kiểm tra scope hiện tại và callback run ghi dữ liệu bằng transaction được truyền vào. Không mở transaction riêng hoặc gọi dịch vụ bên ngoài trong run. Cả lần đầu và replay đều chạy authorize trước khi đọc response cache.

Advisory transaction lock PostgreSQL theo organization/actor/method/route/resource/key trả conflict ngay khi đang tranh chấp; không dùng bộ nhớ trong process để chống trùng. IN_PROGRESS, dữ liệu nghiệp vụ và COMPLETED commit cùng transaction; rollback không để lại khóa. Response thành công chỉ lưu JSON data và status 200/201, tối đa 1 MiB; trường có tên chứa password/token/secret/authorization/cookie làm transaction thất bại thay vì lưu secret. Header `Idempotency-Replayed: true` đánh dấu replay, `false` ở lần thực thi đầu. Envelope cấp requestId mới, không cache header/cookie. UUID header và UUID scalar trong path được normalize chữ thường trước khi xác định scope; version command và canonical DTO nằm trong request hash, mảng giữ thứ tự.

Thiếu/sai UUID trả 400 IDEMPOTENCY_KEY_REQUIRED trước khi claim key. Dọn expired key bằng `pnpm --filter @nexus/api idempotency:prune`, mỗi lần tối đa 100 dòng với SKIP LOCKED; không xóa khóa còn hạn. Test PostgreSQL/HTTP tại `apps/api/test/idempotency.integration-spec.ts` kiểm chứng replay, mười request đồng thời, rollback, quyền/CSRF/scope, TTL và cleanup cạnh tranh retry.

Batch cleanup chọn ID một lần bằng `WITH ... AS MATERIALIZED` rồi DELETE theo tập đó. Cách này giữ đúng giới hạn khi planner chọn nested loop, thay vì đánh giá lại subquery có khóa cho từng dòng; xem [PostgreSQL CTE materialization](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION). Regression test chạy với hash/merge join và optional materialization bị tắt trong transaction riêng.

## Mã lỗi

| HTTP | Code | Ý nghĩa/hành vi client |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Sửa input/UUID/query/header |
| 400 | IDEMPOTENCY_KEY_REQUIRED | Thiếu hoặc sai UUID ở command bắt buộc header |
| 401 | UNAUTHORIZED, SESSION_INVALID | Chưa có phiên hoặc phiên hết hạn/thu hồi |
| 401 | INVALID_CREDENTIALS | Login chung cho email/organization/password/status sai |
| 401 | REFRESH_REUSE_DETECTED | Family đã thu hồi và commit trước response |
| 403 | FORBIDDEN, CSRF_INVALID | Thiếu quyền hoặc Origin/CSRF sai; không refresh loop |
| 403 | PASSWORD_CHANGE_REQUIRED | Chuyển tới đổi mật khẩu; me/logout/password vẫn dùng được |
| 404 | NOT_FOUND | Không tồn tại hoặc ngoài phạm vi |
| 409 | REFRESH_CONFLICT | Tranh chấp <5 giây, không Set-Cookie; phối hợp tab, không retry vô hạn |
| 409 | DUPLICATE_EMAIL, DUPLICATE_CODE, DUPLICATE_SKU | Vi phạm unique trong tổ chức |
| 409 | LAST_ADMIN_REQUIRED, SYSTEM_ROLE_IMMUTABLE | Bảo vệ quản trị và role hệ thống |
| 409 | BRANCH_HAS_ACTIVE_USERS | Cấp chi nhánh hoạt động khác cho nhân viên trước khi ngừng chi nhánh |
| 409 | INVALID_STATE_TRANSITION, SHIPMENT_ALREADY_EXISTS | Command không hợp lệ ở trạng thái hiện tại |
| 409 | INSUFFICIENT_STOCK, BRANCH_WAREHOUSE_NOT_CONFIGURED | Không đủ hàng/kho mặc định |
| 409 | ORDER_HAS_PAYMENTS, PAYMENT_EXCEEDS_TOTAL, DUPLICATE_PAYMENT_REFERENCE | Không hủy đơn đã thu, thu vượt/trùng |
| 409 | APPROVAL_REQUIRED, SELF_APPROVAL_FORBIDDEN | Adjustment cần người khác duyệt |
| 409 | IDEMPOTENCY_KEY_REUSED, REQUEST_IN_PROGRESS | Key khác payload hoặc command đang chạy |
| 422 | BUSINESS_RULE_VIOLATION, EXPORT_LIMIT_EXCEEDED | Input đúng kiểu nhưng vi phạm quy tắc |
| 429 | RATE_LIMITED | Chờ Retry-After giây; không tăng retry dồn |
| 413 | PAYLOAD_TOO_LARGE | JSON vượt 1 MiB; giảm kích thước request |
| 500 | INTERNAL_ERROR | Lỗi nội bộ; dùng requestId để điều tra |
| 503 | DATABASE_UNAVAILABLE, SERVICE_UNAVAILABLE | Tạm thời không sẵn sàng; backoff có giới hạn |

Login giới hạn theo IP và organization/email chuẩn hóa: 10 lần/15 phút, bootstrap/refresh 60 lần/phút/IP. Trả `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` và `Retry-After` khi 429; không tin X-Forwarded-For từ client. MVP một API process, bộ đếm có giới hạn bộ nhớ; nhiều replica phải chuyển shared store trước khi scale (Phase 6).

## Version và ví dụ

Thêm field optional tương thích trong v1; thay meaning/type hoặc xóa field cần v2/ADR và migration client. Deprecation phải ghi ngày ngừng, replacement, header `Deprecation`/`Sunset`, giữ tối thiểu 30 ngày trên demo đã công bố. Không đưa endpoint Phase 5 vào OpenAPI MVP.

POST `/sales/orders` gửi `{customerId,branchId,items:[{variantId,quantity:"3"}],note}` cùng CSRF và Idempotency-Key. Thành công 201 với status DRAFT, subtotal/discountTotal/taxTotal/grandTotal là chuỗi như SRS. Confirm trả 200; thiếu hàng trả 409 INSUFFICIENT_STOCK và mọi dòng rollback.
