# ADR-0003: PostgreSQL là nguồn sự thật; Prisma cho schema và truy vấn

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-14
- **Người quyết định:** @5erax

## Bối cảnh

Dữ liệu ERP (tồn kho, thanh toán, công nợ) đòi hỏi ràng buộc toàn vẹn, transaction và khóa mức hàng. Đồng thời cần một công cụ quản lý schema, migration và truy vấn có kiểu cho TypeScript.

## Quyết định

- **PostgreSQL** là system of record duy nhất cho dữ liệu nghiệp vụ.
- **Prisma** quản lý schema, migration và truy vấn thông thường.
- Những thao tác cần tính nguyên tử cao (giữ hàng bằng `UPDATE ... WHERE on_hand - reserved >= $1`) và các ràng buộc `CHECK` dùng SQL thô qua migration SQL hoặc `$queryRaw`/`$executeRaw`, được bao trong repository của module sở hữu.
- **Redis** chỉ là cache và hàng đợi; không bao giờ là nguồn sự thật cho tồn kho, thanh toán hay công nợ.
- Phiên bản Prisma được ghim; cú pháp transaction và optimistic concurrency phải nhất quán với phiên bản đó.

## Hệ quả

- Có kiểu an toàn và migration có lịch sử; một số ràng buộc nâng cao phải viết bằng SQL thủ công.
- Cần kiểm thử tích hợp trên PostgreSQL thật (không dùng database giả) cho các luồng nhạy cảm.
- Migration phải kiểm chứng được trên database trống trong CI (issue `P0-DEV-002`).

## Cách kiểm chứng

Test tích hợp chạy trên PostgreSQL trong CI; test đồng thời cho giữ hàng (issue `P2-TST-001`).
