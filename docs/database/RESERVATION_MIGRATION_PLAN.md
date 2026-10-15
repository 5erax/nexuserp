# Thứ tự migration của stock reservation

Áp dụng cho #19, #46, #50, #54, #58 và #62. Mục tiêu: Phase 2 kiểm chứng giữ hàng độc lập; không tạo FK tới bảng Sales chưa tồn tại và không đảo dependency Phase 2 → Phase 3.

## Phase 2 — Inventory (#46, #50)

- Tạo `stock_reservations` với UUID, `organization_id`, `balance_id`, `quantity`, `status`, `reference_id` (UUID tương quan do caller cấp), timestamps. **Chưa có cột hoặc FK `order_item_id`.**
- Inventory sở hữu bảng; FK tới balance cùng tổ chức, `quantity > 0`, trạng thái hợp lệ và index cho reservation hiệu lực. `reference_id` phục vụ truy vết/idempotency, không được mô tả như FK tới Sales.
- `reserve/release/consume` nhận transaction từ caller và cập nhật balance nguyên tử. Phase 2 chỉ gọi qua service trong test/technical demo, không có endpoint công khai tạo reservation không gắn đơn.
- Test tích hợp/concurrency tạo reference UUID độc lập, không tạo bảng Sales giả và không tắt FK. Đối soát reserved bằng tổng reservation ACTIVE.

## Phase 3 — Sales (#58, trước #62)

1. Tạo `sales_orders`, `sales_order_items` và các khóa cùng organization trước.
2. Thêm `stock_reservations.order_item_id` nullable và FK ghép `(organization_id, order_item_id)` tới dòng đơn. Mọi giá trị khác NULL phải trỏ tới dòng có thật; không dùng UUID tùy ý.
3. Preflight dừng migration nếu còn reservation ACTIVE không gắn dòng đơn. Dữ liệu test/demo Phase 2 phải được giải phóng qua service; không âm thầm xóa reservation hay chỉnh reserved. Không có nghiệp vụ Sales thật trước bước này.
4. Thêm CHECK `status <> 'ACTIVE' OR order_item_id IS NOT NULL`. Reservation cũ đã RELEASED/CONSUMED có thể giữ `order_item_id=NULL` cùng reference để bảo toàn lịch sử.
5. Interface Inventory dành cho confirm yêu cầu `orderItemId` có thật. Tạo reservation và đổi trạng thái đơn trong cùng transaction; FK bảo vệ scope organization, application kiểm tra variant, kho và số lượng khớp dòng đơn.

Sau #58, fixture cho reservation ACTIVE phải có dòng đơn hợp lệ; cập nhật cả test của #50/#54 trong cùng PR schema. Không tạo vòng dependency issue: #46 → #50; #46 → #58 → #62, và #50 → #62.

## Kiểm chứng khi triển khai migration

- `migrate deploy` trên PostgreSQL trống tới cuối Phase 2 thành công, dù chưa có bảng Sales.
- Tiếp tục tới Phase 3 thành công với database trống hoặc chỉ có reservation không ACTIVE; chạy lại no-op.
- ACTIVE không gắn đơn làm preflight thất bại với hướng dẫn giải phóng; database không bị thay đổi một phần (migration trong transaction).
- FK chặn orphan/cross-organization; CHECK chặn tạo ACTIVE với `order_item_id=NULL` sau Phase 3.
- Bộ concurrency/đối soát Phase 2 được cập nhật fixture và vẫn pass sau Phase 3.

Migration `20261016003000_catalog_inventory` thực thi phần Phase 2; inventory-schema.integration-spec.ts kiểm chứng quantity/FK/unique trên PostgreSQL. Schema chưa có cột/FK order_item_id. Phần preflight và ràng buộc Phase 3 vẫn thuộc #58; không coi phần đó đã triển khai.
