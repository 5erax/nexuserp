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

Mọi write ghi audit trong cùng transaction; thay giá lưu giá trước/sau dạng chuỗi. SKU có stock movement hoặc Sales order-item history trả 409 SKU_HAS_HISTORY; khóa variant trước khi kiểm tra để chặn FK insert chen vào. SQL trigger bảo vệ cả hai loại lịch sử. Test sales-schema.integration-spec.ts kiểm tra SKU đã nằm trên đơn nhưng chưa có movement; sửa tên/giá Catalog không đổi snapshot đơn.

Audit cập nhật product lưu before/after các trường nhỏ, bỏ description khỏi bản ghi header. Khi description thay đổi (kể cả xóa về null), hai bản ghi `catalog.product_description_updated` riêng lưu before và after, cùng entity/requestId và transaction với header; không dựa vào thứ tự UUID để ghép hai phía. Mô tả không đổi không bị lặp vào audit. Mỗi phía tối đa 2.000 ký tự có thể thành 12 KiB khi JSON escape, nên tách để giữ CHECK jsonb 16 KiB mà không cắt dữ liệu hoặc nới constraint. Audit tạo product vẫn lưu after đầy đủ. Test hồi quy bao phủ Unicode, ký tự escape, đổi tên/lưu trữ khi mô tả dài và rollback toàn bộ nếu ghi audit phía cuối thất bại.

Không xóa product/variant qua API. Lưu trữ sản phẩm không xóa biến thể hoặc lịch sử; GET vẫn trả lịch sử cho actor có quyền. GET /product-variants?status=ACTIVE chỉ trả biến thể ACTIVE có cha ACTIVE, dành cho lựa chọn bán hàng. Không truyền status khi quản trị để thấy cả dữ liệu lưu trữ. Khi Sales được triển khai, server vẫn phải kiểm tra trạng thái/giá trong transaction tạo đơn; bộ lọc UI không thay thế kiểm tra đó.

Kiểm chứng API: `apps/api/test/catalog.integration-spec.ts` chạy HTTP thật với PostgreSQL, bao phủ SKU/Decimal, idempotency, scope/read-manage, archive, audit rollback và tranh chấp SKU. OpenAPI và client sinh lại cùng PR. Ledger/reservation ở #49–54; chưa coi luồng bán/xuất kho đã hoạt động.

## Giao diện Catalog

Trang `/catalog/products` có tìm kiếm tên/SKU, lọc danh mục/trạng thái, sắp xếp và phân trang phía server. Trang chi tiết `/catalog/products/:id` tạo/sửa sản phẩm và nhiều biến thể. Actor chỉ có read xem được dữ liệu nhưng không có nút quản trị; backend vẫn kiểm tra lại mọi request. Lưu trữ/khôi phục sản phẩm hoặc SKU phải xác nhận trong dialog, hỗ trợ Escape và khóa nút khi đang lưu. Dữ liệu đã lưu trữ còn tra cứu được; việc lựa chọn bán hàng vẫn dùng bộ lọc ACTIVE ở API.

Form giữ nội dung sau lỗi. POST giữ một UUID trong vòng đời form để bấm gửi lại sau lỗi mạng sử dụng cùng key; 401 recovery của transport cũng giữ key gốc. Không tự retry mutation. Giá tiền luôn gửi bằng chuỗi; hiển thị VND bằng Intl với BigInt để không làm tròn số vượt giới hạn an toàn của Number. Bảng SKU cuộn trong vùng riêng ở 390px, không ép mã/giá thành nhiều dòng; tên dài và nội dung dialog được ngắt dòng.

Component test `catalog-forms.test.tsx` kiểm tra retry giữ key/nội dung, Decimal string, giá VND không hợp lệ, lỗi trùng SKU và SKU có lịch sử. `e2e/catalog-flow.ts` chạy cùng luồng admin trong `e2e/admin.spec.ts`, tái sử dụng hai actor đã login để giữ nguyên quota login thật: tạo sản phẩm khi phản hồi bị mất sau commit rồi thử lại, nhiều SKU/trùng mã, sửa, tìm theo SKU, quyền chỉ xem, xác nhận lưu trữ/khôi phục, tên 200 ký tự, 390px và axe. Không coi các kiểm tra này là nghiệm thu Sales chưa triển khai.
