# ADR-0005: Phân quyền RBAC cộng phạm vi tổ chức, chi nhánh và bản ghi

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Quyền `sales.orders.read` không có nghĩa là được xem mọi đơn hàng của cả doanh nghiệp. Nhân viên chỉ được truy cập chi nhánh được cấp (IAM-004), và mọi kiểm tra phải nằm ở backend (IAM-003).

## Quyết định

- Role gán tập permission; permission có dạng `<module>.<resource>.<action>`, ví dụ `sales.orders.read`.
- Mỗi yêu cầu được kiểm tra theo ba tầng: (1) permission, (2) phạm vi tổ chức và chi nhánh được cấp (`user_branch_access`), (3) quyền sở hữu bản ghi khi quy tắc yêu cầu.
- Guard của NestJS xử lý permission; kiểm tra phạm vi dữ liệu nằm trong lớp application/repository để **mọi truy vấn** đều bị lọc theo phạm vi, tránh IDOR.
- Chính sách mã trạng thái: thiếu permission trả `403`; bản ghi nằm ngoài phạm vi truy cập trả `404` để không lộ sự tồn tại. Có thể xem xét lại bằng ADR mới nếu cần.
- Hành động đặc quyền ghi audit log (IAM-005). Không được vô hiệu hóa quản trị viên hoạt động cuối cùng (IAM-006).

## Hệ quả

- Kiểm soát chi tiết, chống IDOR theo thiết kế; cần ma trận quyền rõ ràng (issue `P0-DOC-003`).
- Mọi repository phải nhận ngữ cảnh phạm vi; thêm chi phí cho mỗi truy vấn.

## Cách kiểm chứng

Bộ test bảo mật IDOR và branch isolation (issue `P1-TST-001`), chạy trong CI.
