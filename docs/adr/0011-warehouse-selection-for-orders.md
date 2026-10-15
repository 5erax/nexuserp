# ADR-0011: Một kho mặc định trong cùng chi nhánh cho mỗi đơn

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-15
- **Issue liên quan:** `P0-ADR-011` (#28)

## Bối cảnh và các lựa chọn

Giữ hàng cần xác định kho. Cho chọn kho chéo chi nhánh hoặc tự chia nhiều kho làm tăng số trường hợp phân quyền và giao hàng. MVP chọn một kho mặc định thuộc chính chi nhánh bán.

## Quyết định

- Chi nhánh có tối đa một kho mặc định đang hoạt động; chưa có kho đó thì không tạo/confirm đơn mới. API trả `BRANCH_WAREHOUSE_NOT_CONFIGURED` (409).
- Server lấy kho mặc định khi tạo đơn, lưu `sales_orders.warehouse_id`. Client không chọn kho khác. Kho này được giữ nguyên trong suốt vòng đời đơn; thay kho mặc định không đổi đơn đã tạo.
- Confirm phải kiểm tra kho vẫn hoạt động, cùng tổ chức và cùng chi nhánh với đơn. Reservation và shipment chỉ lấy từ kho đã lưu; không tự tìm kho khác khi thiếu hàng.
- Khóa ghép bảo vệ quan hệ organization/branch/warehouse tại database; kiểm tra scope tại backend. Có thể có nhiều kho vật lý nhưng bán hàng MVP chỉ dùng kho mặc định.
- Chuyển kho, bán chéo chi nhánh và chia đơn nhiều kho để Phase 5. Không vô hiệu hóa kho khi còn reservation hiệu lực hoặc đơn CONFIRMED chưa xử lý.

## Hệ quả

Luồng giữ hàng/giao đủ một lần đơn giản và kiểm tra được theo chi nhánh. Không tự cân đối hàng giữa các kho.

## Cách kiểm chứng

Issues #19, #46, #53, #58 và #62: test thiếu kho mặc định, đổi mặc định không đổi đơn cũ, tham chiếu chéo tổ chức/chi nhánh, kho ngừng hoạt động và thiếu hàng không chuyển kho ngầm.
