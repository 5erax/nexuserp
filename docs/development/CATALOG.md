# API Catalog — Phase 2

Catalog dùng chung trong tổ chức, chỉ nhận grant ORG. catalog.products.read và catalog.products.manage độc lập; quản lý không tự mở quyền GET. Mọi endpoint cần phiên hợp lệ, write cần Origin/CSRF. POST thêm Idempotency-Key UUID theo [API_CONVENTIONS](../api/API_CONVENTIONS.md).

| Endpoint | Hành vi |
| --- | --- |
| GET/POST /products | Danh sách phân trang hoặc tạo sản phẩm |
| GET/PATCH /products/:id | Đọc/cập nhật thông tin; status INACTIVE để lưu trữ |
| GET /product-variants | Danh sách SKU phân trang, có thể lọc productId |
| POST /products/:id/variants | Tạo SKU cho sản phẩm đang ACTIVE |
| PATCH /product-variants/:id | Đổi tên, giá bán, ngưỡng cảnh báo, status hoặc SKU chưa có lịch sử |

Prefix `/api/v1`. Danh sách lọc category/status, tìm q theo tên sản phẩm/tên biến thể/SKU; products sortBy createdAt/name, variants thêm sku/sellingPrice. page/pageSize và sortOrder dùng quy ước chung, có ID làm tie-breaker. Response không nhúng toàn bộ biến thể vào mỗi sản phẩm; gọi danh sách variant phân trang để không trả mảng con vô hạn. Dữ liệu và total đều lọc organization trước khi tính; ID ngoài phạm vi trả 404.

SKU trim và uppercase, giữ khoảng trắng ở giữa theo dictionary; unique trong tổ chức. Trùng SKU trả 409 DUPLICATE_SKU, kể cả hai request đồng thời. Giá bán là chuỗi số nguyên 0–20 chữ số theo Decimal(20,0); ngưỡng tồn là chuỗi không âm với tối đa 15 chữ số nguyên và 3 chữ số lẻ. Không nhận number/scientific notation/giá âm; trả giá với toFixed(0), ngưỡng với toFixed(3). Request lạ hoặc PATCH rỗng bị từ chối. category/description nhận null để xóa nội dung; name/giá/status không nhận null.

Mọi write ghi audit trong cùng transaction; thay giá lưu giá trước/sau dạng chuỗi. SKU có stock movement trả 409 SKU_HAS_HISTORY; khóa variant trước khi kiểm tra để chặn movement FK insert chen vào. SQL trigger là lớp bảo vệ cuối. Sales/order_items chưa tồn tại; #58 phải bổ sung lịch sử đơn vào kiểm tra SKU khi thêm Sales, không coi phần này đã kiểm chứng đơn hàng.

Không xóa product/variant qua API. Lưu trữ sản phẩm không xóa biến thể hoặc lịch sử; GET vẫn trả lịch sử cho actor có quyền. GET /product-variants?status=ACTIVE chỉ trả biến thể ACTIVE có cha ACTIVE, dành cho lựa chọn bán hàng. Không truyền status khi quản trị để thấy cả dữ liệu lưu trữ. Khi Sales được triển khai, server vẫn phải kiểm tra trạng thái/giá trong transaction tạo đơn; bộ lọc UI không thay thế kiểm tra đó.

Kiểm chứng: `apps/api/test/catalog.integration-spec.ts` chạy HTTP thật với PostgreSQL, bao phủ SKU/Decimal, idempotency, scope/read-manage, archive, audit rollback và tranh chấp SKU. OpenAPI và client sinh lại cùng PR. Giao diện Catalog ở #55, ledger/reservation ở #49–54; chưa coi luồng bán/xuất kho đã hoạt động.
