# Kiến trúc bảo mật — baseline trước triển khai

Nguồn quyết định: [ADR-0005](../adr/0005-rbac-with-resource-scope.md), [ADR-0006](../adr/0006-tenant-aware-single-tenant-mvp.md), [ADR-0010](../adr/0010-cookie-and-csrf-strategy.md). Tài liệu này ghi thiết kế, **chưa chứng minh biện pháp đã hoạt động**; #42 bổ sung đường dẫn mã và test sau khi triển khai Phase 1.

## Ranh giới tin cậy và biện pháp

| Ranh giới / tài sản | Cách lạm dụng cần chặn | Quyết định / kiểm thử dự kiến |
| --- | --- | --- |
| Browser → proxy → API; phiên và mật khẩu | CSRF, giả Origin, lấy token từ JavaScript | Một origin; cookie HttpOnly/Secure; signed double-submit gắn phiên; #33, #35 |
| Request → dữ liệu chi nhánh | Đoán UUID, đổi branchId, leo thang quyền | Permission rồi scope rồi ownership; ngoài scope trả 404; #36–39, #45 |
| Token → database phiên | Replay, hai tab cùng refresh, logout tranh chấp | Khóa family, rotation nguyên tử, revoke commit trước 401; #32, #34, #45 |
| Application → PostgreSQL | Sai tenant, thao tác tồn kho/tiền trùng | Khóa ghép organization; transaction, idempotency; #46, #47, #54, #62 |
| Nghiệp vụ → audit/log | Chối bỏ thay đổi, lộ secret | Audit cùng transaction; loại password/hash/token; #41 |

## Phiên và CSRF

1. Browser lấy bootstrap CSRF qua `/api/v1/auth/csrf` cùng origin.
2. Login xác minh Origin, CSRF và mật khẩu Argon2id, tạo family hạn 7 ngày, đặt cookie access/refresh/CSRF theo ADR-0010.
3. Request được kiểm tra chữ ký JWT, user ACTIVE, family còn hiệu lực và quyền/scope hiện tại từ database. Request thay đổi dữ liệu còn phải kiểm tra CSRF/Origin.
4. Access hết hạn: một refresh tạo một successor, không kéo dài hạn family. Các trường hợp tranh chấp/replay theo [REFRESH_TOKEN_POLICY](REFRESH_TOKEN_POLICY.md).
5. Logout thu hồi family hiện tại; vô hiệu hóa user/reset password thu hồi mọi family của user. Thu hồi ở database chặn cả access JWT còn hạn.

## Giới hạn và việc còn phải kiểm chứng

- CSRF không chặn XSS; token cookie vẫn yêu cầu output encoding và CSP/security headers (#35). Tham số Argon2id và ngưỡng rate limit phải được cấu hình, đo và ghi rõ khi làm #33/#35.
- Một tổ chức ở MVP; khóa organization không tương đương cách ly tenant đầy đủ. Tenant isolation thuộc Phase 6.
- Chỉ dùng dữ liệu mẫu. Không log cookie, token, password hoặc hash; audit không lưu nguyên request chứa secret.
- Test #45 phải chứng minh IDOR, scope và revoke; không chỉ kiểm tra cookie flags. #42 cập nhật biện pháp → file mã → test thực tế, kèm rủi ro còn lại.
