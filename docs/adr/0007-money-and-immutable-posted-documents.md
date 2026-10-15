# ADR-0007: Tiền dùng Decimal; chứng từ đã posted là bất biến

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Số học dấu phẩy động cho sai số làm lệch tiền và công nợ (FIN-001). Chứng từ tài chính và kho đã ghi nhận không được sửa lặng lẽ (FIN-004, INV-005).

## Quyết định

- Lưu và tính tiền bằng `DECIMAL`/`NUMERIC` trong PostgreSQL và Decimal trong ứng dụng; không dùng `float` hay `number` cho phép tính tiền. VND có thể biểu diễn bằng số nguyên đơn vị đồng nếu thống nhất toàn hệ thống.
- API trả và nhận số tiền dưới dạng **chuỗi** (ví dụ `"450000"`) để tránh mất độ chính xác ở JSON.
- Giá và tên sản phẩm được snapshot vào dòng đơn hàng (SAL-003).
- Chứng từ đã `posted` (phiếu kho, bút toán, thanh toán) bất biến ở các trường trọng yếu; sai sót xử lý bằng chứng từ đảo hoặc điều chỉnh, không sửa/xóa.
- Backend không tin giá do frontend gửi; server tính giá và tổng.

## Hệ quả

- Không có sai số làm tròn ngoài ý muốn; cần thư viện Decimal và quy ước làm tròn thống nhất.
- Quy trình sửa sai phức tạp hơn "chỉnh trực tiếp" nhưng có truy vết đầy đủ.

## Cách kiểm chứng

Unit test cho price calculator với các giá trị làm tròn; test từ chối sửa/xóa chứng từ đã posted.
