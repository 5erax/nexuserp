# ADR-0012: Hoãn costing và lợi nhuận tới Phase 5

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-15
- **Issue liên quan:** `P0-ADR-012` (#29)

## Bối cảnh và các lựa chọn

FIFO cần lớp giá vốn; bình quân di động cần quy tắc định giá mọi biến động. Cả hai vượt mục tiêu kiểm chứng Sales/Inventory của MVP. Chọn hoãn costing, thu thập giá nhập tùy chọn để giữ thông tin gốc.

## Quyết định

- MVP không tính lợi nhuận, giá trị tồn kho hoặc COGS. Không công bố `/reports/profit` trong OpenAPI MVP hay UI; không gọi doanh thu là lợi nhuận.
- Movement nhập (`OPENING`, `ADJUSTMENT_IN`) có `unit_cost NUMERIC(20,6)` nullable, không âm nếu có. `NULL` nghĩa là chưa biết, khác với giá vốn bằng 0; API dùng chuỗi thập phân.
- Không tính bình quân trên balance và không suy ra giá vốn xuất kho từ giá bán. Movement `SHIPMENT` có `unit_cost=NULL` ở MVP; dữ liệu này chưa đủ để hứa có báo cáo lợi nhuận lịch sử chính xác.
- Phase 5 phải có ADR chọn phương pháp costing, cách xử lý thiếu giá vốn và cách nâng cấp dữ liệu lịch sử trước khi viết báo cáo. Không sửa movement đã posted để backfill ngầm.

## Hệ quả

MVP chỉ báo cáo doanh thu/đơn/số lượng tồn. Hoãn costing giảm phạm vi; dữ liệu giá vốn thiếu phải xử lý minh bạch khi mở rộng.

## Cách kiểm chứng

Issues #19, #46, #51, #72: test chi phí âm bị từ chối, `NULL` không đổi thành 0; OpenAPI và dashboard MVP không có chỉ số lợi nhuận hay định giá tồn kho.
