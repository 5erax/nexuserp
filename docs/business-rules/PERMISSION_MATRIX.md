# Ma trận quyền MVP

Quy ước `<module>.<resource>.<action>`. Permission catalog bên dưới là đầu vào seed #32, guard #36 và test #45. Mọi API ngoài health, CSRF bootstrap, login và refresh cần phiên hợp lệ; logout/me cần phiên nhưng không cần business permission.

## Phạm vi và role mặc định

`ORG`: toàn tổ chức hiện tại. `BRANCH`: chỉ các chi nhánh ACTIVE được cấp trong `user_branch_access`. `OWN`: thuộc một chi nhánh đã cấp và `created_by = actor.id`; OWN không mở rộng BRANCH. Mọi cấp đều bắt buộc `organization_id = actor.organizationId`. Nhiều role hợp các grant của cùng permission, không suy quyền từ tên role. Với tài nguyên dùng chung tổ chức (catalog, role), BRANCH/OWN không có nghĩa và không được lưu.

| Code role hệ thống | Persona | IAM | Catalog | Inventory | CRM/Sales/Finance | Reporting/Audit |
| --- | --- | --- | --- | --- | --- | --- |
| BUSINESS_OWNER | Chủ doanh nghiệp | ORG mọi quyền | ORG mọi quyền | ORG mọi quyền | ORG mọi quyền | ORG mọi quyền |
| SYSTEM_ADMINISTRATOR | Quản trị hệ thống | ORG mọi quyền | Không | Không | Không | audit ORG |
| BRANCH_MANAGER | Quản lý chi nhánh | users.read, branches.read BRANCH | products.read ORG | read, adjustments.create/approve/post BRANCH; warehouses.read BRANCH | customers.read/create/update, orders.read/create/update/confirm/cancel/history, shipments.create/post, payments.read/create BRANCH | reports read/export, audit BRANCH |
| SALES_STAFF | Nhân viên bán hàng | branches.read BRANCH | products.read ORG | warehouses.read, balances.read BRANCH | customers.read/create/update BRANCH; orders.create BRANCH; orders.read/update/confirm/cancel/history OWN; payments.read OWN | Không |
| WAREHOUSE_STAFF | Nhân viên kho | branches.read BRANCH | products.read ORG | warehouses.read, balances.read, movements.read, adjustments.create/post BRANCH | orders.read/history, shipments.create/post BRANCH | inventory report BRANCH |

Mỗi role hệ thống có `is_system=true`, code và grant bất biến qua API; không xóa hoặc đổi tên. Role tùy chỉnh thuộc tổ chức, không dùng code hệ thống. Chỉ actor có `iam.roles.manage` ORG được tạo/sửa role; grant mới phải nằm trong quyền và scope của actor để ngăn tự nâng quyền. Gán role và thay quyền chi nhánh cần `iam.users.manage` ORG. Branch Manager xem nhân viên thuộc chi nhánh đã cấp, không quản trị tài khoản ở MVP.

Ít nhất một user ACTIVE còn role BUSINESS_OWNER hoặc SYSTEM_ADMINISTRATOR. Thay đổi user/role assignment khóa organization trước khi đếm để bảo vệ trường hợp hai admin cùng tự vô hiệu hóa. System Administrator quản lý nền tảng; chỉ Business Owner có toàn bộ quyền nghiệp vụ mặc định. Purchasing, Accountant, HR là persona dự kiến Phase 5, chưa seed role không dùng.

Quy tắc không cấp vượt quyền cũng áp dụng khi sửa/reset tài khoản có quyền cao hơn actor. Vì vậy System Administrator không reset Business Owner hoặc gán role nghiệp vụ ngoài grant hiện có; Business Owner thực hiện các thao tác đó. Các user có nhiều role được hợp quyền, permission trùng giữa các role không làm thao tác cập nhật thất bại.

## Catalog permission và endpoint

Prefix chung `/api/v1`. `manage` là quyền CRUD quản trị được nêu tại hàng tương ứng; read luôn kiểm tra độc lập. Các cặp GET/POST chia quyền riêng, không ngầm suy manage thành read.

| Permission | Endpoint/hành động | Scope hợp lệ | Phase |
| --- | --- | --- | --- |
| iam.users.read | GET /users, /users/:id | ORG, BRANCH | 1 |
| iam.users.manage | POST /users, PATCH /users/:id; role/branch assignment; revoke sessions | ORG | 1 |
| iam.roles.read | GET /roles, /permissions | ORG | 1 |
| iam.roles.manage | POST /roles, PUT /roles/:id/permissions | ORG | 1 |
| iam.branches.read | GET /branches, /branches/:id | ORG, BRANCH | 1 |
| iam.branches.manage | POST /branches, PATCH /branches/:id | ORG | 1 |
| iam.organization.read | GET /organization | ORG | 1 |
| iam.organization.update | PATCH /organization | ORG | 1 |
| catalog.products.read | GET /products, /products/:id | ORG | 2 |
| catalog.products.manage | POST /products, PATCH /products/:id; POST/PATCH variants | ORG | 2 |
| inventory.warehouses.read | GET /warehouses, /warehouses/:id | ORG, BRANCH | 2 |
| inventory.warehouses.manage | POST /warehouses, PATCH /warehouses/:id; set default | ORG | 2 |
| inventory.balances.read | GET /inventory/balances | ORG, BRANCH | 2 |
| inventory.movements.read | GET /inventory/movements | ORG, BRANCH | 2 |
| inventory.adjustments.create | POST /inventory/adjustments, opening stock | ORG, BRANCH | 2 |
| inventory.adjustments.approve | POST /inventory/adjustments/:id/approve | ORG, BRANCH | 2 |
| inventory.adjustments.post | POST /inventory/adjustments/:id/post | ORG, BRANCH | 2 |
| crm.customers.read | GET /customers, /customers/:id | ORG, BRANCH | 3 |
| crm.customers.create | POST /customers | ORG, BRANCH | 3 |
| crm.customers.update | PATCH /customers/:id | ORG, BRANCH | 3 |
| sales.orders.read | GET /sales/orders, /sales/orders/:id | ORG, BRANCH, OWN | 3 |
| sales.orders.create | POST /sales/orders | ORG, BRANCH | 3 |
| sales.orders.update | PATCH /sales/orders/:id (DRAFT) | ORG, BRANCH, OWN | 3 |
| sales.orders.confirm | POST /sales/orders/:id/confirm | ORG, BRANCH, OWN | 3 |
| sales.orders.cancel | POST /sales/orders/:id/cancel | ORG, BRANCH, OWN | 3 |
| sales.orders.history | GET /sales/orders/:id/history | ORG, BRANCH, OWN | 3 |
| sales.shipments.create | POST /sales/orders/:id/shipments | ORG, BRANCH | 3 |
| sales.shipments.post | POST /sales/shipments/:id/post | ORG, BRANCH | 3 |
| finance.payments.read | GET /finance/orders/:id/payments | ORG, BRANCH, OWN (via order) | 3 |
| finance.payments.create | POST /finance/orders/:id/payments | ORG, BRANCH | 3 |
| reporting.dashboard.read | GET /reports/dashboard | ORG, BRANCH | 4 |
| reporting.sales.read | GET /reports/sales | ORG, BRANCH | 4 |
| reporting.inventory.read | GET /reports/inventory | ORG, BRANCH | 4 |
| reporting.exports.create | GET /reports/{sales,inventory}/export | ORG, BRANCH; requires matching report read | 4 |
| audit.logs.read | GET /audit-logs | ORG, BRANCH; branch scope excludes organization-level events | 1, 4 |

Role shorthand `read` trong bảng persona chỉ các permission có hậu tố `.read` thuộc module đó. BRANCH_MANAGER không được warehouse.manage, products.manage, IAM mutation. WAREHOUSE_STAFF không được adjustments.approve; opening stock chỉ Business Owner/Branch Manager qua command có audit.

## Chính sách điều chỉnh và từ chối

Ngưỡng MVP tính theo tổng `abs(quantity_delta)` của mọi dòng: **trên 10 đơn vị** cần người khác có adjustments.approve cùng scope; tối đa 10 được post với lý do. Mỗi phiếu chỉ có một đơn vị cơ sở theo SKU; ngưỡng số lượng demo không đại diện giá trị tiền, chi phí chưa đầy đủ. Người tạo không tự phê duyệt; sửa phiếu hủy approval. OPENING chỉ được post một lần trên mỗi warehouse/variant chưa có movement. Lưu snapshot ngưỡng vào phiếu để thay cấu hình sau này không sửa lịch sử; chưa thêm giao diện cấu hình ngưỡng.

Thiếu permission trả 403 `FORBIDDEN`. Có permission nhưng ID ngoài organization/branch/ownership trả 404 `NOT_FOUND`; danh sách lọc trước pagination/count, không trả tổng của scope khác. Thiếu branch access không được fallback toàn tổ chức. Giao diện chỉ ẩn thao tác; backend là nơi thực thi.

## Kiểm chứng demo

Business Owner tạo chi nhánh và cấp role/access → Branch Manager hoặc Owner mở tồn đầu kỳ → Sales Staff tạo/confirm đơn OWN → Warehouse Staff giao hàng BRANCH → Branch Manager đọc báo cáo/audit BRANCH. Request của Sales Staff A với ID chi nhánh B phải nhận 404. Hai request đồng thời vẫn áp cùng permission/scope trong transaction. Các test dự kiến ở #36–37, #45, #51, #70, #76.
