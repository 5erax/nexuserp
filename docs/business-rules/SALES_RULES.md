# Quy tắc Sales

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| SAL-001 | Đơn hàng phải có tối thiểu một dòng sản phẩm hợp lệ | 3 | validated items min1, FK variant/customer, application policy | planned:#61 | Chưa triển khai |
| SAL-002 | Số lượng phải dương; giá tiền không âm | 3 | quantity Decimal>0, price>=0 CHECK và DTO | planned:#61 | Chưa triển khai |
| SAL-003 | Giá bán và tên sản phẩm được snapshot vào order item | 3 | snapshot name/sku/unit_price trên order item | planned:#61 | Chưa triển khai |
| SAL-004 | Tổng giảm giá không được vượt giá trị hàng hóa đủ điều kiện | 3 | pricing policy HALF_UP; discount<=subtotal CHECK | planned:#61 | Chưa triển khai |
| SAL-005 | Hủy đơn đã xuất kho phải đi theo quy trình hoàn/đảo giao dịch | 3 | state guard; reject cancel posted/paid; returns Phase5 | planned:#60, planned:#64 | Chưa triển khai |
| SAL-006 | Đơn CONFIRMED không được tùy tiện thay đổi giá hoặc sản phẩm | 3 | state policy + order lock; PATCH DRAFT only | planned:#60, planned:#61 | Chưa triển khai |
| SAL-007 | Mỗi lần confirm phải chống gửi lặp bằng idempotency key | 3 | unique idempotency key + order state transaction | planned:#47, planned:#62 | Chưa triển khai |
| SAL-008 | Không thể giao nhiều hơn số lượng đã xác nhận trừ đi số lượng đã giao hợp lệ | 3 | shipment đủ một lần + reservation consumption | planned:#63 | Chưa triển khai |
| SAL-009 | Hoàn tiền không vượt số tiền thực nhận còn có thể hoàn | 5 | refund ledger không vượt receipt còn có thể hoàn | planned:#7 | Sau MVP |
| SAL-010 | Số đơn hàng phải duy nhất trong phạm vi tổ chức | 3 | document_sequences + unique organization/order_number | planned:#59, planned:#61 | Chưa triển khai |

Kho snapshot từ kho mặc định cùng branch khi tạo đơn; không fallback cross-branch. Số SO dùng document_sequences theo organization/kind/year, không dùng count+1. Payment/cancel/ship khóa order trước balance để thứ tự khóa thống nhất. Xem [state machine](ORDER_STATE_MACHINE.md).
