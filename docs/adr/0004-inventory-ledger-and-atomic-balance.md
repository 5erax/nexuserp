# ADR-0004: Tồn kho là sổ cái append-only cộng số dư cập nhật nguyên tử

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Hai người cùng xác nhận hai đơn khác nhau cho món hàng chỉ còn một cái. Nếu logic là "đọc tồn rồi cập nhật" thì cả hai có thể thành công (overselling). Ngoài ra mọi biến động tồn kho phải truy vết được và không bị xóa.

## Quyết định

- `stock_movements` là sổ cái **append-only**: mỗi biến động tồn kho có một dòng với loại và định danh chứng từ gốc; movement đã posted không bị sửa hay xóa (INV-004, INV-005).
- `stock_balances` là bảng tổng hợp (`on_hand`, `reserved`, `version`) được cập nhật **nguyên tử** cùng transaction với movement; không có API CRUD sửa trực tiếp `on_hand` (INV-008).
- `available = on_hand - reserved` (INV-003).
- Giữ hàng dùng một câu lệnh `UPDATE` có điều kiện trong transaction (xem bên dưới); không có dòng nào được trả về nghĩa là không đủ hàng và transaction rollback.
- Đơn nhiều SKU khóa theo thứ tự cố định (ví dụ sắp theo `id` của balance) và retry có giới hạn khi gặp deadlock hoặc serialization failure.
- Ràng buộc database: `on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand`.
- Có truy vấn đối soát `stock_balances` với tổng `stock_movements`.

```sql
UPDATE stock_balances
SET reserved = reserved + $1, version = version + 1
WHERE id = $2 AND on_hand - reserved >= $1
RETURNING id, on_hand, reserved;
```

## Hệ quả

- Không overselling dù có nhiều request đồng thời; mọi thay đổi truy vết được.
- Mỗi biến động ghi hai nơi (movement và balance) trong một transaction; hàng nóng có thể tranh chấp khóa.
- Cần job hoặc truy vấn đối soát để phát hiện lệch.

## Cách kiểm chứng

Test đồng thời 50–100 request tranh chấp cùng SKU (issue `P2-TST-001`); test đối soát balance và ledger (issue `P2-INV-004`).
