# Quy tắc Finance

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| FIN-001 | Amount phải lưu bằng Decimal hoặc đơn vị tiền nhỏ nhất, không dùng floating-point cho phép tính tiền | 3 | Decimal(20,0) tiền VND; HALF_UP policy | planned:#61, planned:#65 | Chưa triển khai |
| FIN-002 | Không đánh dấu thanh toán thành công trước khi có bằng chứng thanh toán hợp lệ | 3 | manual receipt validated method/reason/reference; posted sau commit | planned:#65 | Chưa triển khai |
| FIN-003 | Mỗi giao dịch thanh toán từ provider phải có external reference chống ghi nhận trùng | 3 | unique external reference theo org/method; provider ngoài MVP | planned:#65 | Chưa triển khai |
| FIN-004 | Bút toán đã posted không được sửa/xóa trực tiếp; sai sót xử lý bằng bút toán đảo hoặc điều chỉnh | 5 | immutable journal + reversal entries | planned:#7 | Sau MVP |
| FIN-005 | Công nợ phải đối soát với chứng từ gốc và các khoản thanh toán được phân bổ | 5 | invoice/payment allocation reconciliation | planned:#7 | Sau MVP |

MVP Finance sở hữu payments trực tiếp order, không invoice/allocation. Tổng đã thu tách doanh thu; CASH/BANK_TRANSFER, amount>0 và không vượt grandTotal. Cấm cancel đơn đã thu tiền. Thuế demo bằng 0; không báo cáo lợi nhuận khi chưa costing (ADR-0012–0014).
