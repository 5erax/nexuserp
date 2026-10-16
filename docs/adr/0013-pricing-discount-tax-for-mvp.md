# ADR-0013: Giá biến thể, một giảm giá theo đơn và thuế bằng 0

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-15
- **Issue liên quan:** `P0-ADR-013` (#30)

## Bối cảnh và các lựa chọn

SRS đề cập price list nhưng chưa có mô hình đó. Chọn giá biến thể và một giảm giá theo đơn; hoãn price list theo nhóm khách/chi nhánh và engine thuế tới Phase 5 nếu cần.

## Quyết định

- VND là tiền tệ duy nhất ở MVP. Server lấy `product_variants.selling_price`, snapshot tên/SKU/đơn giá khi tạo hoặc sửa DRAFT. Confirm giữ snapshot đã lưu; thay đổi giá catalog không đổi đơn đã CONFIRMED.
- Dùng Decimal toàn bộ: `lineTotal = round(quantity * unitPrice)`, `subtotal = sum(lineTotal)`. Làm tròn HALF_UP đến đồng VND (0 chữ số thập phân); tính từng dòng trước khi cộng.
- Một đơn có tối đa một giảm giá: `AMOUNT` nguyên đồng hoặc `PERCENT` từ 0 đến 100 (tối đa 2 chữ số thập phân). Không cộng dồn giảm giá dòng và đơn. `discountTotal = round(subtotal * percent / 100)` hoặc số tiền hợp lệ, không vượt subtotal.
- `taxTotal = 0`, `grandTotal = subtotal - discountTotal`. Đây là quy tắc demo, không phải tính thuế pháp định; API từ chối giá trị thuế khác 0.
- Giá/tổng do client cố truyền bị DTO từ chối; request chỉ có variant, quantity và yêu cầu giảm giá được cấp quyền. API trả/nhận Decimal bằng chuỗi, không chuyển qua JavaScript `number` để tính tiền.
- Giá bán/đơn giá snapshot và tổng tiền VND dùng `NUMERIC(20,0)`; số lượng dùng `NUMERIC(18,3)`, thống nhất Catalog/Inventory và quy ước API. Chỉ chi phí nhập tùy chọn dùng `NUMERIC(20,6)` theo ADR-0012. DTO kiểm tra miền giá trị và kết quả để không vượt độ chính xác database.

## Hệ quả

Calculator là hàm thuần, một quy tắc làm tròn dùng thống nhất. Chưa có phân bổ giảm giá cho hoàn hàng một phần; phải thiết kế ở Phase 5.

## Cách kiểm chứng

Issues #58, #60, #61: test 0.5 đồng làm tròn thành 1, nhiều dòng làm tròn riêng, subtotal 0, giảm 100%, âm/vượt subtotal, thuế khác 0, overflow, sửa giá catalog không đổi snapshot đã confirm.
