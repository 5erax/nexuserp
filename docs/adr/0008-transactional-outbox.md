# ADR-0008: Transactional outbox cho tác vụ cần tin cậy sau commit

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Sau khi một transaction thành công (ví dụ xác nhận đơn) hệ thống cần phát sự kiện, gửi thông báo hoặc cập nhật dữ liệu phụ. Gọi dịch vụ ngoài trong lúc giữ transaction làm kéo dài khóa; gọi sau commit có thể mất sự kiện nếu tiến trình chết.

## Quyết định

- Sự kiện được ghi vào bảng `outbox_events` **trong cùng transaction** với thay đổi nghiệp vụ.
- Một dispatcher đọc outbox và xử lý sau commit, với retry và đánh dấu đã xử lý; consumer phải idempotent.
- Không thực hiện HTTP call bên ngoài khi đang giữ database transaction.
- MVP: bảng `outbox_events` và dispatcher đơn giản trong tiến trình (polling). Redis và BullMQ chỉ được thêm ở Phase 6 khi thật sự cần.

## Hệ quả

- Không mất sự kiện và không giữ khóa khi gọi ngoài; có độ trễ nhỏ giữa commit và xử lý.
- Phải thiết kế consumer idempotent và có cơ chế khôi phục outbox.

## Cách kiểm chứng

Test độ tin cậy: worker chết giữa chừng vẫn xử lý lại đúng một hiệu ứng (issue `P3-OBX-001`, Phase 6).
