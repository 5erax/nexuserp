# ADR-0001: Ghi lại quyết định kiến trúc bằng ADR

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

NexusERP có nhiều quyết định liên quan đến nhau (ranh giới module, mô hình tồn kho, phân quyền, tiền tệ). Nếu chỉ nằm trong đầu hoặc trong lịch sử chat, lý do sẽ bị mất và dễ bị đảo ngược vô tình.

## Quyết định

Mỗi quyết định kiến trúc quan trọng được ghi thành một ADR ngắn trong `docs/adr/`, theo mẫu [`0000-template.md`](0000-template.md), đánh số tăng dần. Quyết định đang chờ được theo dõi bằng issue loại `decision`.

## Hệ quả

- Lý do và đánh đổi được lưu cùng mã nguồn, review được qua pull request.
- Thêm một chút chi phí viết tài liệu cho mỗi quyết định lớn.
- ADR đã Accepted không bị sửa nội dung; thay đổi quyết định bằng ADR mới.
