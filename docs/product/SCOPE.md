# Phạm vi dự án

Nguồn: [SRS](SRS.md) mục I, III và IX. Tài liệu này chốt ranh giới để tránh mở rộng phạm vi không kiểm soát.

## Mục tiêu

Xây một ERP vận hành được cho doanh nghiệp vừa và nhỏ nhiều chi nhánh, đủ để chứng minh: nghiệp vụ liên kết, dữ liệu nhất quán, phân quyền theo phạm vi, xử lý đồng thời, bảo mật và kiểm thử tự động.

## Trong phạm vi MVP (kết thúc Phase 4)

| Module | Chức năng |
| --- | --- |
| IAM & Organization | Đăng nhập, đăng xuất, refresh token rotation, thu hồi phiên; user, role, permission; chi nhánh và quyền truy cập chi nhánh; audit log cho thao tác quản trị |
| Catalog | Sản phẩm, biến thể và SKU, kho |
| Inventory | Tồn đầu kỳ, stock ledger, số dư, đặt trước, điều chỉnh có lý do và phê duyệt theo ngưỡng, đối soát |
| CRM | Khách hàng (hồ sơ và lịch sử giao dịch cơ bản) |
| Sales | Tạo đơn, xác nhận và giữ hàng, tạo phiếu giao và ghi nhận xuất kho, hủy trước khi xuất kho, ghi nhận thanh toán vận hành, lịch sử sự kiện |
| Reporting | Dashboard doanh thu, đơn hàng, tồn kho; audit timeline; export |
| Nền tảng | Monorepo, Docker, CI, migrations, OpenAPI, idempotency, outbox cơ bản, seed data và deployment demo |

## Ngoài phạm vi MVP

| Hạng mục | Khi nào |
| --- | --- |
| Purchasing (PO, nhận hàng, nhà cung cấp) | Phase 5 |
| Chuyển kho, giao hàng một phần, trả hàng | Phase 5 |
| Finance: hóa đơn, công nợ, sổ cái | Phase 5 |
| HRM: nhân viên, chấm công, nghỉ phép | Phase 5 |
| Cách ly tenant đầy đủ, Redis/BullMQ, monitoring, load test | Phase 6 |
| Kế toán pháp định, hóa đơn điện tử, tính lương theo quy định Việt Nam | Phạm vi tích hợp/mở rộng, không cam kết |
| Tích hợp cổng thanh toán | Chưa lên kế hoạch |
| Giao diện tiếng Anh | Cấu trúc i18n sẵn sàng; nội dung tiếng Việt trước |
| Quy đổi đơn vị tính, hết hạn reservation | Sau MVP |

## Giả định

- Một doanh nghiệp, nhiều chi nhánh; tiền tệ mặc định VND.
- Một lập trình viên có kinh nghiệm Frontend, làm khoảng 20–30 giờ mỗi tuần, đang học Backend.
- Dữ liệu demo là dữ liệu mẫu, không có dữ liệu thật.

## Tiêu chí thành công của MVP

Một người đánh giá truy cập được bản demo, đăng nhập từng role và tự thực hiện kịch bản sau:

1. Admin tạo hai chi nhánh và phân quyền cho nhân viên.
2. Nhân viên kho ghi nhận tồn đầu kỳ cho 100 SKU.
3. Nhân viên bán hàng tạo đơn và xác nhận giữ hàng.
4. Hai request đặt cùng SKU chạy đồng thời; hệ thống ngăn overselling.
5. Nhân viên kho tạo phiếu giao và ghi nhận xuất kho.
6. Quản lý xem biến động tồn kho, doanh thu và audit trail.
7. Nhân viên bán hàng chi nhánh A cố truy cập đơn chi nhánh B và nhận 403/404 theo chính sách.

Chất lượng ban đầu (đề xuất, chưa phải kết quả đo): không có lỗi bảo mật critical/high đã biết trước khi phát hành demo; line coverage 80% cho code application/domain; p95 API đọc cơ bản dưới 300 ms và ghi cơ bản dưới 500 ms trên dữ liệu thử nghiệm đã công bố.
