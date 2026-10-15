# Quy tắc Catalog & Inventory

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| INV-001 | SKU phải duy nhất trong một tổ chức | 2 | unique(organization_id,sku), normalize DTO, CHECK uppercase/trim | apps/api/test/inventory-schema.integration-spec.ts; apps/api/test/catalog.integration-spec.ts | Schema/API, gồm tranh chấp SKU, đã kiểm chứng |
| INV-002 | Không cho phép xuất hàng vượt tồn khả dụng | 2 | ledger atomic guarded balance update + CHECK | apps/api/test/stock-ledger.integration-spec.ts; planned:#50, planned:#54 | Ledger đã kiểm chứng; reservation còn lại |
| INV-003 | `available = on_hand - reserved` | 2 | available derived, CHECK reserved<=on_hand | apps/api/test/inventory-schema.integration-spec.ts; planned:#50, planned:#53 | CHECK/Decimal đã kiểm chứng; service/API còn lại |
| INV-004 | Mọi biến động tồn kho phải có stock movement | 2 | ledger append cùng transaction balance, rollback khi lỗi | apps/api/test/stock-ledger.integration-spec.ts; planned:#51 | Posting service đã kiểm chứng; document API còn lại |
| INV-005 | Không được xóa lịch sử xuất nhập kho đã posted | 2 | SQL trigger chặn UPDATE/DELETE stock_movements | apps/api/test/inventory-schema.integration-spec.ts; apps/api/test/stock-ledger.integration-spec.ts | Trigger và posting đã kiểm chứng |
| INV-006 | Chuyển kho phải bảo đảm xuất nguồn và nhập đích được hạch toán đúng trạng thái | 5 | transfer state + transaction nguồn/đích | planned:#7 | Sau MVP |
| INV-007 | Điều chỉnh tồn kho yêu cầu lý do; vượt ngưỡng phải được phê duyệt | 2 | CHECK reason/actor/timestamp; policy tổng abs delta>10 ở application | apps/api/test/inventory-schema.integration-spec.ts; planned:#51 | Constraint đã kiểm chứng; approval policy còn lại |
| INV-008 | Không cho phép sửa trực tiếp `on_hand` từ CRUD API | 2 | chỉ StockLedgerService ghi onHand, test cấu trúc chặn đường ghi khác | apps/api/test/stock-ownership.spec.ts; apps/api/test/catalog.integration-spec.ts | Ledger ownership đã kiểm chứng; Inventory không có CRUD số dư |
| INV-009 | Reservation phải được giải phóng khi hủy đơn hoặc hết hạn hợp lệ | 3 | release/cancel trong transaction order, expiry sau MVP | planned:#52, planned:#64 | Chưa triển khai |
| INV-010 | Không được sửa SKU của sản phẩm đã có giao dịch nếu làm sai lịch sử | 2 | Catalog lock/check + trigger cấm đổi SKU đã có stock movement; FK RESTRICT | apps/api/test/inventory-schema.integration-spec.ts; apps/api/test/catalog.integration-spec.ts; planned:#58 cho Sales | API/DB bảo vệ stock history đã kiểm chứng; lịch sử đơn theo Phase 3 |

Quy tắc bổ sung: Inventory sở hữu warehouse, default warehouse duy nhất trong branch; unit_cost nullable nonnegative ở OPENING/ADJUSTMENT_IN (NULL khác 0). Post shipment giảm cả on_hand/reserved và tiêu thụ reservation. document_sequences do platform sở hữu để cấp số chứng từ trong transaction; UNIQUE là lớp bảo vệ cuối. Reconciliation so sánh sum movements với on_hand và sum ACTIVE reservations với reserved, không tự sửa ledger (#53).
