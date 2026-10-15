# Kế hoạch theo phase

Mỗi phase tạo ra một sản phẩm hoạt động, demo được và có điều kiện nghiệm thu cụ thể. Công việc chi tiết nằm ở GitHub Issues (milestone tương ứng) và [GitHub Project](https://github.com/users/5erax/projects/5). Mỗi phase có một issue theo dõi `P<n>-TRK-000` liệt kê các issue con.

> Các mốc thời gian là ước lượng kế hoạch, không phải cam kết. Giả định một lập trình viên có kinh nghiệm Frontend, làm khoảng 20–30 giờ/tuần và đang học Backend. Phase 2 (đồng thời, ledger) dự kiến khó nhất. Finance và HRM có thể kéo dài đáng kể nếu triển khai đúng yêu cầu pháp định.

| Phase | Tên | Ước lượng | Milestone |
| --- | --- | --- | --- |
| 0 | Product & Architecture Foundation | 1–2 tuần | Phase 0 — Foundation |
| 1 | IAM & Organization | 2–3 tuần | Phase 1 — IAM |
| 2 | Catalog & Inventory | 3–4 tuần | Phase 2 — Catalog & Inventory |
| 3 | CRM Core & Sales | 3–4 tuần | Phase 3 — CRM & Sales |
| 4 | Reporting & Portfolio MVP Release | 2–3 tuần | Phase 4 — MVP Release |
| 5 | Advanced Business ERP | 6–10 tuần | Phase 5 — Advanced ERP |
| 6 | Hardening & SaaS Preparation | 3–5 tuần | Phase 6 — Hardening |

## Phase 0 — Product & Architecture Foundation

Chốt scope, user stories, business rules; ERD, API conventions, ADR; monorepo, Docker, CI, migrations; design tokens và skeleton UI.

**Definition of Done:** khởi chạy frontend, backend và database bằng tài liệu setup; CI chạy lint, typecheck, unit tests và migration verification.

## Phase 1 — IAM & Organization

Đăng nhập, đăng xuất, token rotation, thu hồi phiên; user, role, permission; kiểm soát truy cập chi nhánh; audit log cho thao tác quản trị.

**Definition of Done:** nhân viên không truy cập được dữ liệu chi nhánh chưa cấp quyền, kể cả khi gọi API trực tiếp.

## Phase 2 — Catalog & Inventory

Sản phẩm, biến thể, SKU, kho; tồn đầu kỳ, stock ledger; stock balance, reservation; điều chỉnh và kiểm thử đồng thời.

**Definition of Done:** không xuất vượt tồn; không phát sinh hai lần movement khi retry; stock balances đối soát được với movement ledger.

## Phase 3 — CRM Core & Sales

Khách hàng, đơn bán, snapshot giá; confirm → reserve → giao đủ một lần; hủy trước xuất kho; Finance tối giản ghi nhận thanh toán thủ công vào đơn. Chưa có hóa đơn, công nợ hay hoàn tiền.

**Definition of Done:** hoàn thành end-to-end một đơn hàng, tồn kho thay đổi chính xác và mọi sự kiện đều truy vết được.

## Phase 4 — Reporting & Portfolio MVP Release

Dashboard doanh thu/đơn/tồn; audit timeline, export; kiểm thử tích hợp và E2E; seed data, tài khoản demo, deployment.

**Definition of Done:** một người đánh giá truy cập được bản demo, đăng nhập từng role và tự thực hiện quy trình nghiệp vụ đã tài liệu hóa.

> **Mốc portfolio MVP kết thúc ở Phase 4.** Phase 5–6 chỉ bắt đầu khi nền tảng này đủ tin cậy.

## Phase 5 — Advanced Business ERP

Purchasing và supplier management; chuyển kho, giao hàng một phần, trả hàng; nền tảng Finance (hóa đơn, công nợ phải thu, sổ cái); HRM cơ bản và báo cáo nâng cao.

**Definition of Done:** hoàn chỉnh luồng mua hàng, bán hàng, hoàn trả và đối soát công nợ với dữ liệu thử nghiệm nhất quán.

## Phase 6 — Hardening & SaaS Preparation

Thiết kế cách ly tenant và kiểm thử bảo mật; Redis, jobs, outbox consumers; monitoring, diễn tập backup/restore; load test và hardening bảo mật.

**Definition of Done:** có bằng chứng đo hiệu năng, khôi phục dữ liệu, kiểm thử phân quyền và tài liệu vận hành.

## Định nghĩa "Ready" cho một issue

Một issue sẵn sàng để bắt đầu khi có: mục tiêu, dependencies đã xong, acceptance criteria quan sát được, test cases, các quyết định ADR liên quan đã Accepted.
