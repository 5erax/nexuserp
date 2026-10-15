# Architecture Decision Records

ADR ghi lại các quyết định kiến trúc quan trọng cùng bối cảnh và hệ quả của chúng. Quy trình: mở issue loại **decision**, soạn ADR từ [`0000-template.md`](0000-template.md), merge khi đạt trạng thái *Accepted*. ADR đã Accepted không bị sửa nội dung; muốn đổi thì viết ADR mới và đánh dấu ADR cũ là *Superseded*.

## Đã chấp nhận

Các quyết định "khóa từ đầu" trong SRS (mục XIII).

| ADR | Quyết định |
| --- | --- |
| [0001](0001-record-architecture-decisions.md) | Ghi lại quyết định kiến trúc bằng ADR |
| [0002](0002-modular-monolith.md) | Modular monolith, không dùng microservices ở MVP |
| [0003](0003-postgresql-prisma-source-of-truth.md) | PostgreSQL là nguồn sự thật; Prisma cho schema và truy vấn |
| [0004](0004-inventory-ledger-and-atomic-balance.md) | Tồn kho: sổ cái append-only và số dư cập nhật nguyên tử |
| [0005](0005-rbac-with-resource-scope.md) | Phân quyền: RBAC cộng phạm vi tổ chức, chi nhánh, bản ghi |
| [0006](0006-tenant-aware-single-tenant-mvp.md) | Một tổ chức ở MVP, schema sẵn sàng cho multi-tenant |
| [0007](0007-money-and-immutable-posted-documents.md) | Tiền dùng Decimal; chứng từ đã posted là bất biến |
| [0008](0008-transactional-outbox.md) | Transactional outbox cho tác vụ cần tin cậy sau commit |
| [0009](0009-rest-openapi-versioned-api.md) | REST có version, OpenAPI-first, quy chuẩn lỗi thống nhất |

## Đang chờ quyết định

Theo dõi bằng issue; ADR được viết khi chốt.

| ADR | Câu hỏi | Cần chốt trước | Issue |
| --- | --- | --- | --- |
| 0010 | Chiến lược cookie và CSRF giữa Next.js và NestJS | Phase 1 | `P0-ADR-010` |
| 0011 | Đơn hàng giữ hàng từ kho nào; có bán chéo chi nhánh không | Phase 2 | `P0-ADR-011` |
| 0012 | Phương pháp tính giá vốn và phạm vi báo cáo lợi nhuận | Phase 2 | `P0-ADR-012` |
| 0013 | Giá, giảm giá và thuế ở MVP | Phase 3 | `P0-ADR-013` |
| 0014 | Ghi nhận thanh toán tối giản ở Phase 3 | Phase 3 | `P0-ADR-014` |
| 0015 | Package manager và công cụ monorepo | Phase 0 | `P0-ADR-015` |
