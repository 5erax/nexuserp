# Từ điển dữ liệu — Phase 0–4

IAM, Catalog và Inventory đã triển khai. Schema CRM/Sales/Finance và outbox nằm trong migration `20261016040000_crm_sales`; API nghiệp vụ Phase 3 được triển khai tiếp ở #59–67. Audit append-only giữ migration riêng.

| Bảng.cột | Kiểu / constraint | Ý nghĩa |
| --- | --- | --- |
| organizations.id | UUID PK, UUID do Prisma tạo | Tổ chức |
| organizations.code | varchar(32), unique | Mã tổ chức |
| organizations.name | varchar(200), NOT NULL | Tên |
| organizations.currency | varchar(3), CHECK VND | Tiền tệ MVP |
| organizations.timezone | varchar(64), default Asia/Ho_Chi_Minh | Múi giờ |
| branches.id | UUID PK; unique cùng organization_id | Chi nhánh |
| branches.organization_id | UUID FK, ON DELETE RESTRICT | Không xóa tổ chức khi còn chi nhánh |
| branches.code | varchar(32), unique cùng organization_id | Mã trong tổ chức |
| branches.name | varchar(200), NOT NULL | Tên |
| branches.status | varchar(16), CHECK ACTIVE/INACTIVE | Trạng thái |
| Cả hai bảng.created_at | timestamptz(3), default now | Thời điểm tạo |
| Cả hai bảng.updated_at | timestamptz(3), Prisma updatedAt | Thời điểm thay đổi |

Index unique tổ chức/mã chi nhánh và tổ chức/ID hỗ trợ scope và FK ghép cho schema sau. Không soft-delete baseline; API IAM ở Phase 1 triển khai deactivate theo business rule.

## Quy ước chung cho thiết kế đích

Các bảng dưới đây chưa được coi đã migrate chỉ vì có trong dictionary. Phase 1 #32/#41, Phase 2 #46/#47, Phase 3 #58/#67 triển khai lần lượt.

- Entity: `id UUID PK`, `organization_id UUID NOT NULL FK organizations RESTRICT`, `created_at timestamptz(3) DEFAULT now()`, `updated_at timestamptz(3)` do ứng dụng cập nhật; unique `(organization_id,id)` cho FK ghép. Bảng append-only bỏ updated_at; bảng liên kết ghi cột riêng dưới đây.
- Mọi FK entity scoped dùng `(organization_id,parent_id) REFERENCES parent(organization_id,id) ON DELETE RESTRICT`; không FK đơn ID xuyên tenant. Ngoại lệ global permissions không organization. Bảng con cần cùng branch tham chiếu unique `(organization_id,branch_id,id)` của parent. Index FK theo truy vấn, không dựa việc PostgreSQL tự tạo index FK.
- Giá bán và tổng tiền VND `Decimal(20,0)`; quantity `Decimal(18,3)`; không âm theo quy tắc. Unit cost gốc là `Decimal(20,6)` nullable theo ADR-0012, chưa dùng để định giá tồn kho. Không floating-point trong phép tính. NULL unit_cost là chưa biết, 0 là được ghi rõ bằng 0.
- Tài khoản/chứng từ có lịch sử không xóa cứng; status allowlist CHECK, posted chỉ append. Không CASCADE xóa lịch sử audit/movement/payment. Mọi update nghiệp vụ đều qua module sở hữu.
- Chuỗi mô tả `varchar(200)`, code `varchar(64)` trừ khi ghi khác; trim API. JSON payload allowlist, tối đa 16 KiB, không password/token hoặc PII không cần thiết.

## IAM — Phase 1, chủ sở hữu iam

| Bảng | Cột bổ sung / kiểu / constraint | Unique và index | Xóa và rule |
| --- | --- | --- | --- |
| users | email varchar(254) lowercase/trim CHECK; display_name varchar(200); password_hash varchar(512) NOT NULL CHECK Argon2id format; must_change_password boolean default false; status varchar(16) ACTIVE/INACTIVE/LOCKED | unique(org,email), unique(org,id); index(org,status) | Org RESTRICT; IAM-001/002; không trả hash qua API; reset đặt cờ buộc đổi mật khẩu |
| roles | code varchar(64); name varchar(200); is_system boolean default false | unique(org,code), unique(org,id) | Org RESTRICT; system grant/code bất biến qua API |
| permissions | id UUID PK; code varchar(100) unique; allowed_scopes varchar(32) NOT NULL | unique(code) | Global catalog, không xóa permission đang được dùng; seed immutable |
| user_roles | organization_id,user_id,role_id UUID; created_at timestamptz(3) | PK(user_id,role_id); index(org,role_id) | FK ghép user/role RESTRICT, xóa assignment có kiểm tra last admin IAM-006 |
| role_permissions | organization_id,role_id,permission_id UUID; scope varchar(8) CHECK ORG/BRANCH/OWN | PK(role_id,permission_id); index(permission_id) | Role FK ghép RESTRICT; permission FK RESTRICT; scope phải thuộc allowed_scopes ở application |
| user_branch_access | organization_id,user_id,branch_id UUID; created_at timestamptz(3) | PK(user_id,branch_id); index(org,branch_id) | User/branch FK ghép RESTRICT; IAM-004 |
| refresh_families | user_id UUID; expires_at timestamptz(3); revoked_at timestamptz(3) nullable; created_at; không updated_at | unique(org,id), unique(id,user_id); index(user_id,expires_at) | User FK ghép RESTRICT; expires tuyệt đối login+7d, CHECK expires_at>created_at |
| refresh_sessions | family_id UUID; token_hash char(64) SHA-256 lowercase; expires_at; rotated_at/revoked_at nullable; replaced_by UUID nullable; ip varchar(64) nullable; user_agent varchar(512) nullable; created_at; không organization/updated_at | token_hash unique; unique(family_id,id), unique(family_id,replaced_by); index(family_id,expires_at) | Family FK RESTRICT; successor FK(family_id,replaced_by) cùng family RESTRICT; CHECK replaced_by và rotated_at cùng null hoặc cùng có; không tự trỏ |

Refresh session scope thông qua family; session expiry phải bằng family expiry được application kiểm tra trong transaction. Metadata IP/UA chỉ chẩn đoán có giới hạn, không chứng minh cùng người dùng; không log giá trị trong HTTP log. Giữ token hash cũ đến khi family hết hạn; dọn expiry theo batch mà không xóa family trước sessions, không xóa audit cùng cleanup.

## Audit — Phase 1, chủ sở hữu audit

`audit_logs` append-only: entity common fields trừ updated_at; `branch_id UUID nullable`, `actor_id UUID nullable`, `action varchar(100)`, `entity_type varchar(64)`, `entity_id UUID nullable`, `request_id varchar(64)`, `ip varchar(64) nullable`, `user_agent varchar(512) nullable`, `changes jsonb` tối đa 16 KiB. FK ghép branch/actor RESTRICT. Index `(org,created_at,id)`, `(org,branch_id,created_at)`, `(org,entity_type,entity_id)` có thể scan ngược cho timeline DESC. Nullable branch là tổ chức, không hiển thị cho scope BRANCH. Actor null cho system event hoặc failed login không resolve được user; không ghi password/token, không JSON dump toàn DTO. Mutation và audit dùng cùng transaction. Audit failed auth chỉ có org khi resolve được org; nếu không có thì structured security log không chứa credential. Trigger chặn UPDATE/DELETE; retention demo chưa tự xóa, trước production phải chốt retention trong ADR vận hành.

## Catalog — Phase 2, chủ sở hữu catalog

| Bảng | Cột bổ sung / kiểu / constraint | Unique và index | FK/xóa và rule |
| --- | --- | --- | --- |
| products | name varchar(200); category varchar(100) nullable; description varchar(2000) nullable; status ACTIVE/INACTIVE | unique(org,id), index(org,status,name) | Org RESTRICT; deactivate thay xóa |
| product_variants | product_id UUID; sku varchar(64) uppercase trim; name varchar(200); selling_price Decimal(20,0)>=0; low_stock_threshold Decimal(18,3)>=0 default0; status ACTIVE/INACTIVE | unique(org,sku), unique(org,id), index(org,product_id,status) | Product FK ghép RESTRICT; SKU có movement không đổi, INV-001/010 |

## Inventory — Phase 2, chủ sở hữu inventory

| Bảng | Cột bổ sung / kiểu / constraint | Unique và index | FK/xóa và rule |
| --- | --- | --- | --- |
| warehouses | branch_id UUID; code varchar(32); name; status ACTIVE/INACTIVE; is_default boolean default false | unique(org,code), unique(org,branch_id,id); partial unique(org,branch_id) WHERE is_default AND status='ACTIVE'; index(org,branch_id,status) | Branch FK ghép RESTRICT; chuyển default khóa branch, không fallback khác branch |
| stock_balances | warehouse_id,variant_id UUID; on_hand/reserved Decimal(18,3) default0; version int default0 | unique(org,warehouse_id,variant_id), unique(org,id), index(org,variant_id) | Warehouse/variant FK ghép RESTRICT; CHECK on_hand>=0, reserved>=0, reserved<=on_hand, version>=0 |
| stock_reservations | balance_id,reference_id UUID; order_item_id UUID nullable; quantity Decimal(18,3)>0; status ACTIVE/RELEASED/CONSUMED | unique(org,balance_id,reference_id); index(org,balance_id,status); index(org,order_item_id) | Balance FK ghép RESTRICT; FK ghép order item RESTRICT; CHECK ACTIVE yêu cầu liên kết, terminal lịch sử Phase2 được NULL |
| stock_movements | warehouse_id,variant_id UUID; quantity_delta Decimal(18,3) !=0; unit_cost Decimal(20,6) nullable >=0; reference_type OPENING/ADJUSTMENT_IN/ADJUSTMENT_OUT/SHIPMENT_OUT; reference_id UUID; created_by UUID | unique(org,reference_type,reference_id,variant_id); partial unique(org,warehouse_id,variant_id) WHERE type=OPENING; index(org,warehouse_id,created_at,id) | Warehouse/variant/actor FK ghép RESTRICT; SQL trigger reject UPDATE/DELETE; unit_cost chỉ nullable inbound, outbound luôn null |
| stock_adjustments | warehouse_id,created_by UUID; approved_by UUID nullable; kind OPENING/ADJUSTMENT; status DRAFT/PENDING_APPROVAL/APPROVED/POSTED/CANCELLED/REJECTED; reason varchar(1000) NOT NULL; decision_reason varchar(1000) nullable; approval_threshold Decimal(18,3) default10; approved_at/posted_at nullable | index(org,warehouse_id,status,created_at), unique(org,id) | Warehouse/actor FK ghép RESTRICT; CHECK approved_by != created_by; threshold>=0; REJECTED cần decision_reason; application kiểm tra tổng abs delta và state; trigger cấm UPDATE/DELETE phiếu POSTED |
| stock_adjustment_items | adjustment_id,variant_id UUID; quantity_delta Decimal(18,3) !=0; unit_cost Decimal(20,6) nullable>=0 | unique(org,adjustment_id,variant_id), index(org,variant_id) | Adjustment/variant FK ghép RESTRICT; OPENING chỉ delta>0; outbound cost NULL; trigger khóa phiếu và cấm thêm/sửa/xóa/chuyển dòng của phiếu POSTED; command kiểm tra 1–100 item |

Movement append và balance update cùng transaction; reserve/release không movement vì không thay on_hand. Reconciliation read-only so sánh ledger và ACTIVE reservations. Opening chỉ khi chưa có movement trên cặp kho/SKU, không ghi đè tồn. Posted document trigger/policy giữ nguyên dữ liệu gốc; cleanup test phải dùng database test có ownership, không mở API sửa ledger để hỗ trợ test.

## CRM/Sales — Phase 3

| Chủ sở hữu / bảng | Cột bổ sung / kiểu / constraint | Unique và index | FK/xóa và rule |
| --- | --- | --- | --- |
| crm / customers | branch_id UUID bất biến; name varchar(200); email varchar(254) nullable trim/lowercase; phone varchar(32) nullable trim; address varchar(1000) nullable; notes varchar(2000) nullable; status ACTIVE/INACTIVE; created_by UUID bất biến | unique(org,branch_id,id); index(org,branch_id,name) | Branch/actor FK ghép RESTRICT; cho phép contact dùng chung, không tự gộp; API archive thay DELETE; lịch sử đơn qua public Sales interface và scope orders.read độc lập; xem [CRM](../development/CRM.md) |
| sales / sales_orders | branch_id,warehouse_id,customer_id,created_by UUID; order_number varchar(32); status DRAFT/CONFIRMED/CANCELLED/FULFILLED; currency VND; subtotal/discount_total/tax_total/grand_total Decimal(20,0); discount_type NONE/AMOUNT/PERCENT; discount_value Decimal(20,3); note varchar(2000) nullable; version int default0 | unique(org,order_number), unique(org,id), unique(org,branch_id,id); index(org,branch_id,status,created_at,id), index(org,created_by) | Warehouse/customer FK(org,branch,id) RESTRICT; actor FK ghép RESTRICT; CHECK totals>=0, discount<=subtotal, grand_total=subtotal-discount_total+tax_total; tax_total=0 MVP |
| sales / sales_order_items | order_id,variant_id UUID; sku varchar(64); product_name varchar(200); quantity Decimal(18,3)>0; delivered_quantity Decimal(18,3) default0 trong [0,quantity]; unit_price/line_total Decimal(20,0)>=0 | unique(org,order_id,variant_id), unique(org,id), unique(org,order_id,id) | Order/variant FK ghép RESTRICT; snapshot bất biến sau confirm; delivered_quantity chỉ tăng trên CONFIRMED; terminal bất biến |
| sales / shipments | order_id UUID; status DRAFT/POSTED/CANCELLED; created_by UUID; posted_at nullable | partial unique(org,order_id) WHERE status IN ('DRAFT','POSTED'); index(org,created_at) | Order/actor FK ghép RESTRICT; chỉ giao đủ một lần, giữ unique parent cùng org/order/id |
| sales / shipment_items | shipment_id,order_id,order_item_id UUID; quantity Decimal(18,3)>0 | unique(org,shipment_id,order_item_id) | FK(org,order_id,shipment_id) tới shipment và FK(org,order_id,order_item_id) tới order item RESTRICT, ngăn dòng của đơn khác |
| sales / order_events | order_id UUID; action varchar(100); actor_id UUID nullable; request_id varchar(64); payload jsonb; created_at; không updated_at | index(org,order_id,created_at,id) | Order/actor FK ghép RESTRICT; append-only, viết qua public Sales interface trong transaction |

## Finance — Phase 3

`payments`: entity common fields trừ updated_at; `sales_order_id UUID`, `amount Decimal(20,0) CHECK >0`, `method varchar(16) CHECK CASH/BANK_TRANSFER`, `external_reference varchar(200) nullable` chuẩn trim/uppercase, `reason varchar(1000)`, `received_at timestamptz(3)`, `created_by UUID`. FK ghép order/actor RESTRICT. Partial unique `(org,method,external_reference)` WHERE reference IS NOT NULL, CHECK BANK_TRANSFER phải có reference; index `(org,sales_order_id,created_at,id)`.

Receipt bất biến sau commit, không status do client sửa. Khóa order rồi SUM payments để chặn vượt tổng hoặc cancel đã thu; tổng liên bảng không thể chỉ dựa CHECK cục bộ. Số đã thu và trạng thái UNPAID/PARTIAL/PAID derived. SQL trigger chặn update/delete payment. Không allocation/invoice/refund trong MVP.

## Nền tảng — Phase 2–3

| Bảng / phase / owner | Cột và constraint | Index/xóa |
| --- | --- | --- |
| idempotency_keys / 2 / platform | id UUID PK; organization_id,actor_id UUID; command varchar(512) gồm method/route/resource; key UUID; request_hash char(64) lowercase hex; status IN_PROGRESS/COMPLETED; response jsonb; response_status 200/201 khi COMPLETED; created_at,expires_at timestamptz(3); CHECK expiry>created và state/response khớp; response không chứa secret | unique(org,actor,command,key); index(expires_at); org/actor FK ghép RESTRICT; TTL24h, xóa expired theo batch; migration 20261016010000_idempotency |
| document_sequences / 2–3 / platform | organization_id UUID; kind varchar(16) SO/ADJ/SHIP; year int; next_value bigint CHECK>0 | PK(org,kind,year); org FK RESTRICT; transaction UPSERT increment, không count+1, không tái dùng số đã phát hành |
| outbox_events / 3 / platform | id UUID PK; organization_id UUID; event_type varchar(100); aggregate_id UUID; payload jsonb allowlist; attempts int default0 CHECK>=0; status PENDING/PROCESSING/PUBLISHED/DEAD; available_at/created_at timestamptz(3); locked_until nullable; lock_token UUID nullable; published_at nullable; last_error varchar(200) nullable đã sanitize | index(available_at,id) WHERE published_at IS NULL; org FK RESTRICT; schema lease/status đã có; dispatcher/consumer SKIP LOCKED và retry bounded ở #67, event ID ổn định |
| outbox_receipts / 3 / platform | event_id UUID PK; organization_id UUID; event_type varchar(100); aggregate_id UUID; processed_at timestamptz(3) | unique(org,event_id); FK(org,event_id) → outbox_events(org,id) RESTRICT; immutable trigger; consumer insert skip duplicate tạo đúng một receipt bền vững/event |

Reporting Phase 4 không thêm bảng; aggregate chỉ đọc dữ liệu đúng scope, doanh thu theo đơn FULFILLED/posted_at, tiền thu theo received_at. Không tính profit hoặc coi order grandTotal là tiền đã thu.

## Truy vết constraint và bảng sau MVP

IAM-001 → user email unique/lowercase; IAM-004 → FK ghép và AccessScope; IAM-006 → khóa organization + application. INV-001/002/003 → SKU unique, balance CHECK và atomic guard; INV-004/005 → transaction/immutable trigger; INV-007 → adjustment policy. SAL-001–004 → item/total CHECK + pricing; SAL-005–008 → state/idempotency/reservation transaction; SAL-010 → sequence + unique. FIN-001–003 → Decimal, payment validation/unique reference + khóa order. Các rule liên bảng được test PostgreSQL, không tuyên bố một CHECK giải quyết toàn bộ nghiệp vụ.

**Dự kiến Phase 5:** suppliers, purchase_orders/items, goods_receipts/items, stock_transfers/items, sales_returns/items, refunds, invoices, payment_allocations, gl_accounts, journal_entries/lines, employees/attendance/leave. **Dự kiến Phase 6:** shared rate-limit/job storage và tenant isolation đầy đủ. Chưa có migration hoặc API cho các bảng này; cần ADR và dictionary chi tiết trước khi triển khai.
