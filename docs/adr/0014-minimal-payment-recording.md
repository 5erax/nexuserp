# ADR-0014: Finance sở hữu thanh toán thủ công vào đơn từ Phase 3

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-15
- **Issue liên quan:** `P0-ADR-014` (#31)

## Bối cảnh và các lựa chọn

MVP cần ghi nhận đã thu tiền, trong khi hóa đơn và công nợ ở Phase 5. Chọn Finance tối giản từ Phase 3; tránh tạo bảng thanh toán trong Sales rồi chuyển chủ sở hữu.

## Quyết định

- Finance sở hữu `payments` liên kết trực tiếp đơn bằng khóa cùng tổ chức; endpoint `GET/POST /api/v1/finance/orders/:id/payments` kiểm tra permission và phạm vi chi nhánh của đơn qua interface Sales.
- Chỉ ghi nhận tiền cho đơn CONFIRMED hoặc FULFILLED. Nhân viên có quyền xác nhận tiền đã thực nhận, kèm phương thức (`CASH`/`BANK_TRANSFER`), thời điểm nhận, lý do/tham chiếu bằng chứng; chuyển khoản bắt buộc có `external_reference`. Không tích hợp provider/webhook ở MVP.
- `amount > 0`, VND, Decimal nguyên đồng; cấm tổng đã nhận vượt `grandTotal`. Khóa đơn trong transaction theo cùng thứ tự với cancel/ship, kiểm tra tổng các payment đã posted rồi ghi payment, audit và sự kiện qua interface công khai của module sở hữu. Không ghi trực tiếp bảng Sales từ Finance.
- `external_reference` được chuẩn hóa và duy nhất theo `(organization_id, method, external_reference)` khi khác NULL. Tiền mặt có thể không có tham chiếu, vẫn bắt buộc `Idempotency-Key`.
- `UNPAID`/`PARTIAL`/`PAID` được suy ra từ tổng payment bất biến. Không có API sửa/xóa payment đã posted hoặc sửa tay trạng thái thanh toán.
- MVP từ chối hủy đơn đã có tiền thực nhận (`ORDER_HAS_PAYMENTS`, 409), kể cả chưa giao. Hoàn tiền và đảo payment thuộc Phase 5; chỉ dùng dữ liệu demo trong MVP.
- Phase 5 thêm hóa đơn/phân bổ bằng migration đã review; giữ nguyên ID và lịch sử payment, không rewrite chứng từ gốc.

## Hệ quả

Đã thu tiền khác doanh thu: báo cáo phải tách hai chỉ số. MVP chưa xử lý thu thừa, hoàn tiền và đối soát ngân hàng tự động.

## Cách kiểm chứng

Issues #21, #58, #64, #65, #71: thanh toán một phần/đủ, trùng reference/idempotency, hai lần thu đồng thời không vượt tổng, payment tranh chấp cancel, đơn DRAFT/CANCELLED bị từ chối, scope khác chi nhánh bị từ chối.
