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
| [0010](0010-cookie-and-csrf-strategy.md) | Một origin, HttpOnly cookie, CSRF gắn phiên và chính sách rotation |
| [0011](0011-warehouse-selection-for-orders.md) | Đơn lấy từ một kho mặc định thuộc cùng chi nhánh |
| [0012](0012-costing-and-profit-report.md) | Hoãn costing/lợi nhuận tới Phase 5, không coi chi phí chưa biết là 0 |
| [0013](0013-pricing-discount-tax-for-mvp.md) | Giá biến thể, một giảm giá theo đơn, VND làm tròn HALF_UP, thuế 0 |
| [0014](0014-minimal-payment-recording.md) | Finance tối giản ghi nhận thanh toán vào đơn từ Phase 3 |
| [0015](0015-package-manager-and-monorepo-tooling.md) | pnpm workspaces và Turborepo, khóa phiên bản khi scaffold |

ADR-0010–0015 giải quyết các issue quyết định #27–31 và #9. Trạng thái Accepted ghi quyết định thiết kế; không đồng nghĩa mã ứng dụng đã triển khai hay kiểm thử. Issue chỉ đóng khi PR tài liệu được merge.
