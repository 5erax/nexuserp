# Quy tắc Purchasing

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| PUR-001 | PO phải được phê duyệt trước khi phát hành nếu vượt ngưỡng | 5 | PO approval policy | planned:#7 | Sau MVP |
| PUR-002 | Không nhận hàng nhiều hơn mức được phép theo chính sách PO | 5 | receipt quantity policy + lock PO items | planned:#7 | Sau MVP |
| PUR-003 | Goods Receipt posted mới làm tăng tồn kho | 5 | receipt post transaction + inventory interface | planned:#7 | Sau MVP |
| PUR-004 | Không được xóa PO đã phát sinh nhận hàng | 5 | RESTRICT FK + không delete PO đã nhận | planned:#7 | Sau MVP |
