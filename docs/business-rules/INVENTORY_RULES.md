# Quy tắc Catalog & Inventory

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| INV-001 | SKU phải duy nhất trong một tổ chức | 2 | unique(organization_id,sku) | planned:#46, planned:#48 | Chưa triển khai |
| INV-002 | Không cho phép xuất hàng vượt tồn khả dụng | 2 | atomic guarded balance update + CHECK | planned:#50, planned:#54 | Chưa triển khai |
| INV-003 | `available = on_hand - reserved` | 2 | available derived, CHECK reserved<=on_hand | planned:#46, planned:#50, planned:#53 | Chưa triển khai |
| INV-004 | Mọi biến động tồn kho phải có stock movement | 2 | movement append cùng transaction balance | planned:#50, planned:#51, planned:#53 | Chưa triển khai |
| INV-005 | Không được xóa lịch sử xuất nhập kho đã posted | 2 | không API delete/update posted; SQL trigger chống sửa movement | planned:#46, planned:#50 | Chưa triển khai |
| INV-006 | Chuyển kho phải bảo đảm xuất nguồn và nhập đích được hạch toán đúng trạng thái | 5 | transfer state + transaction nguồn/đích | planned:#7 | Sau MVP |
| INV-007 | Điều chỉnh tồn kho yêu cầu lý do; vượt ngưỡng phải được phê duyệt | 2 | adjustment policy: reason, tổng abs delta>10, khác approver | planned:#51 | Chưa triển khai |
| INV-008 | Không cho phép sửa trực tiếp `on_hand` từ CRUD API | 2 | DTO không nhận onHand; chỉ command ledger | planned:#49, planned:#50 | Chưa triển khai |
| INV-009 | Reservation phải được giải phóng khi hủy đơn hoặc hết hạn hợp lệ | 3 | release/cancel trong transaction order, expiry sau MVP | planned:#52, planned:#64 | Chưa triển khai |
| INV-010 | Không được sửa SKU của sản phẩm đã có giao dịch nếu làm sai lịch sử | 2 | variant policy cấm đổi SKU đã giao dịch; không cascade delete | planned:#48 | Chưa triển khai |

Quy tắc bổ sung: Inventory sở hữu warehouse, default warehouse duy nhất trong branch; unit_cost nullable nonnegative ở OPENING/ADJUSTMENT_IN (NULL khác 0). Post shipment giảm cả on_hand/reserved và tiêu thụ reservation. document_sequences do platform sở hữu để cấp số chứng từ trong transaction; UNIQUE là lớp bảo vệ cuối. Reconciliation so sánh sum movements với on_hand và sum ACTIVE reservations với reserved, không tự sửa ledger (#53).
