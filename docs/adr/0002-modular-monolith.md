# ADR-0002: Modular monolith, không dùng microservices ở MVP

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

ERP có các luồng xuyên module cần tính nhất quán chặt (xác nhận đơn hàng phải giữ hàng trong cùng một transaction). Dự án do một lập trình viên phát triển, cần chi phí vận hành thấp nhưng vẫn phải có ranh giới rõ ràng để có thể tách module về sau.

## Các lựa chọn đã xét

1. **Microservices** — tách sớm; transaction phân tán, vận hành phức tạp, không cần thiết ở quy mô này.
2. **Monolith không có ranh giới** — nhanh lúc đầu nhưng nhanh chóng thành khối rối, khó kiểm thử và khó tách.
3. **Modular monolith** — một deployable, mỗi module đóng gói quy tắc và dữ liệu của mình.

## Quyết định

Chọn **modular monolith** bằng NestJS. Mỗi business module (`iam`, `catalog`, `crm`, `sales`, `inventory`, `purchasing`, `finance`, `hrm`, `reporting`, `audit`) có các lớp `presentation / application / domain / infrastructure`.

Quy tắc bắt buộc:

- Controller không truy cập database trực tiếp.
- Mỗi module sở hữu quy tắc nghiệp vụ và **mọi thao tác ghi** vào bảng của mình.
- Module khác chỉ tương tác qua application interface công khai hoặc domain event, không cập nhật bảng của module khác.
- Transaction ngắn; không gọi HTTP bên ngoài khi đang giữ transaction.

## Hệ quả

- Giữ được transaction ACID cho các luồng như confirm đơn và giữ hàng; deploy và debug đơn giản.
- Rủi ro coupling ngầm giữa module; giảm thiểu bằng quy tắc import tự động kiểm tra trong CI (issue `P0-ARC-004`).
- Có thể tách module thành service độc lập sau này nhưng không nằm trong kế hoạch MVP.

## Cách kiểm chứng

Lint rule hoặc dependency-cruiser chặn import xuyên lớp và xuyên module; review PR kiểm tra quy tắc sở hữu thao tác ghi.
