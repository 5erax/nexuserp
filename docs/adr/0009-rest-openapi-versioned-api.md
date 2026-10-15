# ADR-0009: REST có version, OpenAPI-first, quy chuẩn lỗi thống nhất

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Frontend và backend phát triển song song cần hợp đồng API rõ ràng. Lỗi nghiệp vụ cần mã ổn định để frontend xử lý và để kiểm thử.

## Quyết định

- Toàn bộ API dùng tiền tố `/api/v1`, JSON, và được mô tả bằng OpenAPI; client TypeScript được sinh từ hợp đồng vào `packages/contracts`.
- Response thành công: `{ "data": ..., "meta": { "requestId": "..." } }`. Lỗi: `{ "error": { "code", "message", "details", "requestId" } }` với `code` ổn định (ví dụ `INSUFFICIENT_STOCK`).
- Mã HTTP: 200/201 thành công; 400 request không hợp lệ; 401 chưa xác thực; 403 thiếu quyền; 404 không tìm thấy trong phạm vi truy cập; 409 xung đột trạng thái hoặc dữ liệu; 422 vi phạm quy tắc nghiệp vụ không thuộc loại conflict; 429 vượt giới hạn; 500 lỗi hệ thống, không lộ chi tiết nội bộ.
- Endpoint dạng lệnh (`confirm`, `post`, `approve`) và các POST dễ bị retry hỗ trợ header `Idempotency-Key`; lưu khóa cùng actor, route, request hash, kết quả và thời điểm hết hạn.
- Trạng thái đơn hàng, phiếu kho chỉ thay đổi qua endpoint lệnh có chính sách chuyển trạng thái, không qua endpoint cập nhật chung.
- Mọi thay đổi API cập nhật OpenAPI contract trong cùng PR.

## Hệ quả

- Hợp đồng rõ ràng, sinh client tự động; thêm bước duy trì spec.
- Cần middleware requestId, bộ lọc lỗi thống nhất và framework idempotency (issue `P0-ARC-002`, `P2-ARC-001`).

## Cách kiểm chứng

CI kiểm tra spec hợp lệ và client sinh ra không lệch; test API E2E kiểm tra định dạng lỗi và idempotency.
