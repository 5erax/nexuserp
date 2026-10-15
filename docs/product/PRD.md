# PRD — NexusERP portfolio MVP

## Vấn đề và mục tiêu

Doanh nghiệp nhiều chi nhánh cần bán hàng và theo dõi tồn kho trong cùng quy trình, tránh nhận đơn vượt hàng và lộ dữ liệu giữa chi nhánh. Người vận hành cần biết ai đã thay đổi chứng từ, tiền đã thu và đơn đã giao; người đánh giá cần tự chạy được demo từ trình duyệt.

MVP kết thúc Phase 4 theo [SCOPE](SCOPE.md). Chứng minh tính nhất quán và quyền truy cập qua luồng order-to-cash tối giản, không cam kết kế toán pháp định hoặc tích hợp provider. Các quyết định thực thi đã Accepted trong ADR-0001–0015.

## Persona và nhu cầu

| Persona | Nhu cầu | Kết quả quan sát |
| --- | --- | --- |
| Business Owner | Phân quyền, xem toàn doanh nghiệp, cấu hình catalog/kho | Tạo hai chi nhánh, hoàn thành demo và so sánh báo cáo |
| System Administrator | Quản lý tài khoản/role, xử lý sự cố có audit | Không mất admin cuối cùng; thu hồi phiên có hiệu lực ngay |
| Branch Manager | Vận hành và kiểm soát điều chỉnh tại chi nhánh | Duyệt phiếu của người khác; xem KPI đúng scope |
| Sales Staff | Tạo/xác nhận đơn và quản lý khách | Snapshot giá đúng, không giữ hàng vượt khả dụng |
| Warehouse Staff | Tồn đầu kỳ, điều chỉnh, giao hàng và đối soát | Movement đầy đủ, không post lặp, balances khớp ledger |

## Phân kỳ và tiêu chí

| Phase | Giá trị giao được | Điều kiện nghiệm thu |
| --- | --- | --- |
| 0 | Nền tảng và hợp đồng rõ ràng | Setup chạy được, CI chặn lỗi; rule/story/schema có truy vết |
| 1 | Đăng nhập và quản trị an toàn | Cookies/CSRF/rotation, deny default, branch IDOR và last-admin race được kiểm thử |
| 2 | Catalog và kiểm soát tồn | Atomic reservation, movement bất biến, adjustment approval và reconciliation |
| 3 | Order-to-ship và khoản thu thủ công | Confirm/cancel/ship/payment đồng bộ; rollback và replay đúng |
| 4 | Báo cáo và demo có thể đánh giá | Dashboard/export đúng scope, 7 bước demo, CI/security/performance evidence và hướng dẫn vận hành |
| 5–6 | ERP nâng cao và SaaS | Backlog dự kiến sau MVP, chưa coi các thiết kế này là chức năng đã chạy |

## Chỉ số thành công

- Demo có 1 tổ chức, 2 chi nhánh, 2 kho, ít nhất 5 nhân viên và 100 SKU dữ liệu giả (#78).
- Bảy bước SRS mục XII chạy được qua giao diện/API, không có bước chỉnh dữ liệu bằng SQL thủ công.
- Test cạnh tranh: SKU cuối cùng chỉ giữ một lần, retry không nhân chứng từ, branch A không đọc/sửa B.
- Mục tiêu trước release: 80% line application/domain, không critical/high reachable đã biết; p95 read<300ms/write<500ms trên dataset và cấu hình được công bố. Đây là mục tiêu, chỉ ghi đạt sau khi đo #77.

## Luồng và giới hạn

Inventory Control: khai báo SKU/kho → mở tồn → đọc balance/movement → điều chỉnh có lý do/phê duyệt → đối soát. Order-to-cash MVP: tạo khách → DRAFT → CONFIRMED/giữ đủ → shipment POSTED/giảm tồn → ghi khoản đã nhận → báo cáo tách doanh thu/tiền thu.

VND, timezone Asia/Ho_Chi_Minh, tiếng Việt, single organization demo. Warehouse theo branch mặc định; giao đủ một lần; không hủy đơn đã thu tiền. Thuế demo 0, không costing/profit. Dữ liệu thật, Purchasing/HRM, hoàn tiền, chuyển kho, provider và tenant isolation đầy đủ ngoài MVP. Xem [user stories](USER_STORIES.md), [ma trận quyền](../business-rules/PERMISSION_MATRIX.md) và [kịch bản nghiệm thu](../testing/ACCEPTANCE_SCENARIOS.md).
