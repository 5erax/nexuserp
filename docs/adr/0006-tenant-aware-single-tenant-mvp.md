# ADR-0006: Một tổ chức ở MVP, schema sẵn sàng cho multi-tenant

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Định hướng dài hạn là SaaS nhưng MVP chỉ phục vụ một doanh nghiệp nhiều chi nhánh. Thiết kế multi-tenant đầy đủ ngay từ đầu làm chậm MVP; bỏ qua hoàn toàn thì việc thêm sau rất tốn kém.

## Quyết định

- Mọi bảng giao dịch có `organization_id`. Các bảng lõi (đơn hàng, tồn kho, người dùng) dùng khóa/constraint ghép để không thể tham chiếu chéo tổ chức.
- MVP vận hành **một** tổ chức. Tài liệu và README **không tuyên bố** đã cách ly tenant hoàn chỉnh.
- Thiết kế cách ly tenant (xem xét row-level security, kiểm thử bảo mật) thuộc Phase 6.

## Hệ quả

- Giảm chi phí chuyển sang multi-tenant về sau; thêm một cột và vài ràng buộc cho mỗi bảng.
- Phải trung thực về mức đảm bảo hiện tại khi trình bày dự án.

## Cách kiểm chứng

Review schema: bảng giao dịch mới phải có `organization_id`; test bảo mật tenant ở Phase 6 (issue theo dõi `P6-TRK-000`).
