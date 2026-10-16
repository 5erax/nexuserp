# CRM khách hàng — Phase 3

CRM sở hữu bảng customers, hồ sơ và trạng thái ACTIVE/INACTIVE. Sales sở hữu orders, giá và lịch sử đơn. Customer history gọi public `OrdersService.list`; CRM không ghi hoặc tự query bảng Sales để né scope.

## API và dữ liệu

Prefix `/api/v1`: GET/POST `/customers`, GET/PATCH `/customers/:id`, GET `/customers/:id/orders`. POST yêu cầu CSRF và Idempotency-Key; replay giữ nguyên response lần đầu, nên sau retry hãy GET hồ sơ hiện tại. PATCH chỉ nhận các trường hồ sơ/status, không đổi branchId, createdBy hoặc ID. Không có DELETE. Khách đã có đơn được FK RESTRICT bảo vệ; INACTIVE vẫn xem được hồ sơ/lịch sử, không được dùng để tạo đơn mới.

Tên bắt buộc, trim và tối đa 200 ký tự. Email tùy chọn được trim/lowercase, kiểm tra định dạng và tối đa 254 ký tự. Điện thoại giữ cách viết của người dùng sau trim, tối đa 32 ký tự; không suy quốc gia hoặc tự gộp theo số điện thoại. Address/notes tùy chọn, tối đa 1000/2000 ký tự, có thể xóa bằng null. Name/status không nhận null. Request có field ngoài allowlist bị từ chối.

**Chính sách contact dùng chung:** email/điện thoại không phải định danh duy nhất. Một công ty, hộ gia đình hoặc người phụ trách có thể dùng chung contact cho nhiều hồ sơ; API cho phép trùng, không tự gộp hoặc cập nhật bản ghi khác. Hai lần tạo với hai key khác nhau tạo hai UUID khác nhau; retry cùng key tạo đúng một hồ sơ. Người nhập tìm theo tên/email/điện thoại trước khi tạo và chọn đúng UUID; tính năng này không phải cơ chế khử trùng contact tự động. Kiểm thử tạo/sửa/search áp dụng cùng chính sách, không có constraint unique contact ngầm.

## Phân quyền và tìm kiếm

Read/create/update có permission riêng `crm.customers.*`, scope ORG hoặc BRANCH. Scope luôn kết hợp AND với branch/status/q trước count và pagination; `q` trim tìm contains trên tên/email/phone, không tìm notes/address. Sort mặc định createdAt DESC rồi ID; có sortBy=name và sortOrder chung. Tạo mới cần chi nhánh ACTIVE. Hồ sơ lịch sử không bị xóa khi chi nhánh ngừng hoạt động; actor ORG có thể tiếp tục duy trì hồ sơ, actor BRANCH chỉ thấy chi nhánh đang được cấp.

History cần cả `crm.customers.read` cho hồ sơ và `sales.orders.read` cho giao dịch. Không có quyền Sales trả 403, không trả tiền/tổng đơn dựa riêng vào quyền CRM. Scope OWN của Sales chỉ thấy đơn do actor tạo trong chi nhánh được cấp; Branch Manager thấy đơn trong chi nhánh mình, Owner thấy trong tổ chức. Hồ sơ ngoài scope trả 404 trước khi đọc history. History nhận pagination/q chung và trả ID/số/trạng thái/tiền tệ/grandTotal/createdAt, không trả toàn bộ dòng hàng. Filter customerId không nhận từ query; server buộc ID từ route sau kiểm tra hồ sơ.

## Ghi dữ liệu và audit

Write khóa organization FOR SHARE, đọc lại quyền/branch assignment trong transaction, rồi khóa customer FOR NO KEY UPDATE khi sửa. Cùng thứ tự organization → customer với Sales snapshot FOR SHARE; cập nhật hồ sơ không chen giữa bước kiểm tra khách ACTIVE và tạo order. Replay cũng kiểm tra lại quyền hiện tại. Create/update, audit và idempotency cùng transaction; audit lỗi rollback toàn bộ.

Audit giữ before/after của tên/email/phone/status và danh sách trường được sửa. Không sao chép nội dung address/notes vào log bất biến: bảo vệ văn bản riêng tư và giữ mỗi payload dưới giới hạn 16 KiB, kể cả khi cả hai bản ghi chú Unicode dài tối đa. Nội dung hiện tại vẫn nằm trong hồ sơ theo quyền CRM. Chưa có optimistic version cho hồ sơ; hai PATCH cùng một trường được tuần tự hóa và giá trị commit sau cùng thắng, audit lưu cả hai lần sửa.

## Kiểm chứng

`customers.dto.spec.ts` kiểm tra normalization, nullable fields, field allowlist và branch/creator bất biến. `customers.integration-spec.ts` chạy trên PostgreSQL `_test` với UUID-owned fixtures: contact dùng chung, pagination/search, ORG/BRANCH/foreign organization, history OWN/BRANCH và thiếu quyền Sales, archive giữ đơn, validation, replay, audit rollback, ghi chú dài và stale actor/replay sau thu hồi branch. Cleanup chỉ xóa dữ liệu fixture đã tạo; không reset database.

Màn hình CRM được làm ở #69; không coi API đã có là UI đã hoàn thành.
