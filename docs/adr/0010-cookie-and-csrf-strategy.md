# ADR-0010: Cùng origin, cookie HttpOnly và CSRF gắn với phiên

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-15
- **Issue liên quan:** `P0-ADR-010` (#27), `P1-AUTH-002` (#34)

## Bối cảnh và các lựa chọn

Web cần phiên qua cookie theo SRS. API khác origin hoặc BFF giữ token riêng làm tăng cấu hình và thêm luồng xác thực. Chọn một origin công khai, proxy `/api/v1` tới NestJS; không thêm BFF ở MVP.

## Quyết định

- Local và demo đều truy cập API qua origin của web. NestJS không mở API trực tiếp ra Internet trong deployment demo. CORS không dùng wildcard với credentials; request thay đổi dữ liệu phải có `Origin` khớp origin cấu hình, thiếu hoặc `null` cũng bị từ chối.
- Access JWT: 15 phút, cookie `nexus_access`, `HttpOnly`, `SameSite=Lax`, `Path=/api/v1`. Refresh token: ngẫu nhiên ít nhất 256 bit, cookie `nexus_refresh`, cùng cờ, `Path=/api/v1/auth` để cả refresh và logout nhận được cookie. Không đặt `Domain`; `Secure=true` ở HTTPS demo, chỉ tắt cho HTTP localhost.
- Mỗi lần login tạo một family có hạn tuyệt đối 7 ngày. Rotation không kéo dài hạn này. JWT mang `sub`, `organizationId`, `familyId`, `exp`; mỗi request kiểm tra user ACTIVE và family còn hiệu lực trong database để logout/revocation có hiệu lực ngay.
- Database chỉ lưu hash refresh token. Giữ bản ghi token đã xoay tới khi family hết hạn để phát hiện replay; không lưu/log token thô. Logout thu hồi cả family của thiết bị hiện tại và xóa cookie bằng đúng tên/path đã đặt.
- CSRF dùng signed double-submit gắn với `familyId`: cookie `nexus_csrf` đọc được bằng JavaScript (`Path=/`, `SameSite=Lax`, `Secure` theo môi trường, không có `Domain`) và header `X-CSRF-Token`. HMAC dùng secret server; kiểm tra chữ ký, ràng buộc phiên và khớp header/cookie bằng so sánh constant-time. Giữ token CSRF ổn định trong cùng family để rotation giữa các tab không gây lỗi.
- `GET /api/v1/auth/csrf` cấp token bootstrap gắn với cookie pre-auth HttpOnly ngẫu nhiên, hết hạn sau 10 phút. Login kiểm tra bootstrap CSRF và Origin trước khi tạo family, sau đó thay bằng CSRF của phiên và xóa pre-auth cookie. Endpoint bootstrap không có CORS cho origin lạ. Refresh/logout dùng family tìm từ refresh cookie, không đòi access JWT còn hạn.
- Mọi POST/PATCH/PUT/DELETE qua cookie đều phải qua CSRF, kể cả login/refresh/logout. Token đăng nhập không lưu trong localStorage và không trả trong JSON. Response phiên dùng `Cache-Control: no-store`.
- Rotation khi có tranh chấp tuân theo [REFRESH_TOKEN_POLICY](../architecture/REFRESH_TOKEN_POLICY.md); cửa sổ 5 giây chỉ trả lỗi 409, không cấp lại token cũ hoặc token kế nhiệm.

## Hệ quả

Proxy phải giữ nguyên `Set-Cookie`, HTTPS và origin bên ngoài. Chuyển sang nhiều origin cần ADR thay thế. XSS vẫn có thể gửi lệnh trong phiên; CSRF không thay thế kiểm soát XSS. Access JWT cần kiểm tra family ở database để đảm bảo thu hồi ngay.

## Cách kiểm chứng

Issues #32–35 và #43 phải có test cho cookie/path/logout, hết hạn 7 ngày, thu hồi access sau logout, CSRF bootstrap/phiên, Origin sai/thiếu, và refresh khi JWT hết hạn. Ma trận tranh chấp nằm trong chính sách refresh.

## Tham chiếu

[OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) khuyến nghị double-submit có chữ ký và gắn với phiên. Cookie path, TTL và cửa sổ tranh chấp là lựa chọn của NexusERP.
