# ERD triển khai — Phase 0–4

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ BRANCHES : owns
    ORGANIZATIONS {
        uuid id PK
        varchar code UK
        varchar name
        varchar currency
        varchar timezone
        timestamptz created_at
        timestamptz updated_at
    }
    BRANCHES {
        uuid id PK
        uuid organization_id FK
        varchar code
        varchar name
        varchar status
        timestamptz created_at
        timestamptz updated_at
    }
```

Sơ đồ organization/branch khớp migration Phase 0. Các sơ đồ sau là **thiết kế đích**, chỉ trở thành bảng đã triển khai khi migration của phase tương ứng được gộp. Cột, unique/CHECK và index xem [DATA_DICTIONARY](DATA_DICTIONARY.md). Mọi quan hệ giữa entity thuộc tổ chức dùng khóa ghép organization, ON DELETE RESTRICT trừ bảng liên kết có ghi ngoại lệ.

## IAM và Audit — Phase 1

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ USERS : owns
    ORGANIZATIONS ||--o{ ROLES : owns
    USERS ||--o{ USER_ROLES : assigned
    ROLES ||--o{ USER_ROLES : grants
    ROLES ||--o{ ROLE_PERMISSIONS : has
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : catalog
    USERS ||--o{ USER_BRANCH_ACCESS : allowed
    BRANCHES ||--o{ USER_BRANCH_ACCESS : scopes
    USERS ||--o{ REFRESH_FAMILIES : starts
    REFRESH_FAMILIES ||--o{ REFRESH_SESSIONS : rotates
    REFRESH_SESSIONS |o--o| REFRESH_SESSIONS : successor
    ORGANIZATIONS ||--o{ AUDIT_LOGS : records
    USERS {
        uuid id PK
        uuid organization_id FK
        varchar email "lowercase; org unique"
        varchar password_hash
        varchar status "ACTIVE, INACTIVE, LOCKED"
    }
    ROLES {
        uuid id PK
        uuid organization_id FK
        varchar code "org unique"
        boolean is_system
    }
    PERMISSIONS {
        uuid id PK
        varchar code UK
        varchar allowed_scopes
    }
    ROLE_PERMISSIONS {
        uuid organization_id FK
        uuid role_id FK
        uuid permission_id FK
        varchar scope "ORG, BRANCH, OWN"
    }
    REFRESH_FAMILIES {
        uuid id PK
        uuid organization_id FK
        uuid user_id FK
        timestamptz expires_at "absolute login plus 7 days"
        timestamptz revoked_at
    }
    REFRESH_SESSIONS {
        uuid id PK
        uuid family_id FK
        char token_hash UK
        timestamptz expires_at
        timestamptz rotated_at
        timestamptz revoked_at
        uuid replaced_by FK "same family"
    }
    AUDIT_LOGS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK "nullable organization event"
        uuid actor_id FK "nullable system"
        varchar action
        uuid entity_id
        varchar request_id
        jsonb changes "allowlisted, no secrets"
    }
```

## Catalog và Inventory — Phase 2

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ PRODUCTS : owns
    PRODUCTS ||--o{ PRODUCT_VARIANTS : has
    BRANCHES ||--o{ WAREHOUSES : owns
    WAREHOUSES ||--o{ STOCK_BALANCES : aggregates
    PRODUCT_VARIANTS ||--o{ STOCK_BALANCES : sku
    STOCK_BALANCES ||--o{ STOCK_RESERVATIONS : reserves
    WAREHOUSES ||--o{ STOCK_MOVEMENTS : ledger
    PRODUCT_VARIANTS ||--o{ STOCK_MOVEMENTS : sku
    WAREHOUSES ||--o{ STOCK_ADJUSTMENTS : adjusts
    STOCK_ADJUSTMENTS ||--|{ STOCK_ADJUSTMENT_ITEMS : contains
    PRODUCT_VARIANTS ||--o{ STOCK_ADJUSTMENT_ITEMS : sku
    PRODUCTS {
        uuid id PK
        uuid organization_id FK
        varchar name
        varchar category
        varchar status
    }
    PRODUCT_VARIANTS {
        uuid id PK
        uuid organization_id FK
        uuid product_id FK
        varchar sku "org unique"
        decimal selling_price
        varchar status
    }
    WAREHOUSES {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        boolean is_default "one ACTIVE default per branch"
        varchar status
    }
    STOCK_BALANCES {
        uuid id PK
        uuid organization_id FK
        uuid warehouse_id FK
        uuid variant_id FK
        decimal on_hand
        decimal reserved
        int version
    }
    STOCK_RESERVATIONS {
        uuid id PK
        uuid organization_id FK
        uuid balance_id FK
        uuid reference_id
        decimal quantity
        varchar status
    }
    STOCK_MOVEMENTS {
        uuid id PK
        uuid organization_id FK
        uuid warehouse_id FK
        uuid variant_id FK
        decimal quantity_delta
        decimal unit_cost "nullable inbound only"
        varchar reference_type
        uuid reference_id
    }
    STOCK_ADJUSTMENTS {
        uuid id PK
        uuid organization_id FK
        uuid warehouse_id FK
        varchar status
        varchar reason
        decimal approval_threshold
        uuid created_by FK
        uuid approved_by FK
    }
    STOCK_ADJUSTMENT_ITEMS {
        uuid id PK
        uuid organization_id FK
        uuid adjustment_id FK
        uuid variant_id FK
        decimal quantity_delta
        decimal unit_cost
    }
```

Migration Phase 2 ban đầu chưa có order_item_id/FK. Migration Phase 3 20261016040000_crm_sales thêm nullable order_item_id, composite FK cùng organization và CHECK ACTIVE bắt buộc có liên kết sau preflight; lịch sử RELEASED/CONSUMED cũ được giữ. Xem [kế hoạch migration](RESERVATION_MIGRATION_PLAN.md).

## CRM, Sales và Finance tối giản — Phase 3

```mermaid
erDiagram
    BRANCHES ||--o{ CUSTOMERS : serves
    CUSTOMERS ||--o{ SALES_ORDERS : buys
    WAREHOUSES ||--o{ SALES_ORDERS : snapshot
    USERS ||--o{ SALES_ORDERS : creates
    SALES_ORDERS ||--|{ SALES_ORDER_ITEMS : contains
    PRODUCT_VARIANTS ||--o{ SALES_ORDER_ITEMS : snapshot
    SALES_ORDER_ITEMS ||--o{ STOCK_RESERVATIONS : links
    SALES_ORDERS ||--o{ SHIPMENTS : fulfills
    SHIPMENTS ||--|{ SHIPMENT_ITEMS : contains
    SALES_ORDER_ITEMS ||--o{ SHIPMENT_ITEMS : ships
    SALES_ORDERS ||--o{ PAYMENTS : receives
    SALES_ORDERS ||--o{ ORDER_EVENTS : history
    CUSTOMERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        varchar name
        varchar email
        varchar phone
        varchar status
    }
    SALES_ORDERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid warehouse_id FK "same branch"
        uuid customer_id FK "same branch"
        uuid created_by FK
        varchar order_number "org unique"
        varchar status
        decimal subtotal
        decimal discount_total
        decimal tax_total
        decimal grand_total
    }
    SALES_ORDER_ITEMS {
        uuid id PK
        uuid organization_id FK
        uuid order_id FK
        uuid variant_id FK
        varchar sku
        varchar product_name
        decimal quantity
        decimal unit_price
        decimal line_total
    }
    PAYMENTS {
        uuid id PK
        uuid organization_id FK
        uuid sales_order_id FK
        decimal amount
        varchar method
        varchar external_reference
        timestamptz received_at
        uuid created_by FK
    }
    ORDER_EVENTS {
        uuid id PK
        uuid organization_id FK
        uuid order_id FK
        varchar action
        varchar request_id
    }
```

Shipment DRAFT/POSTED/CANCELLED; payment là receipt posted bất biến, không có provider status. Payment/order/warehouse/customer chống tham chiếu khác organization/branch bằng FK ghép. Invoice, allocation, refund, transfer, supplier, PO, goods receipt, journal, HR là **dự kiến Phase 5**, không tạo trong migration MVP.

## Nền tảng và Reporting

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ IDEMPOTENCY_KEYS : scopes
    USERS ||--o{ IDEMPOTENCY_KEYS : actor
    ORGANIZATIONS ||--o{ DOCUMENT_SEQUENCES : numbers
    ORGANIZATIONS ||--o{ OUTBOX_EVENTS : emits
    IDEMPOTENCY_KEYS {
        uuid id PK
        uuid organization_id FK
        uuid actor_id FK
        varchar command
        uuid resource_id
        uuid key
        char request_hash
        jsonb response
        int response_status
        timestamptz expires_at
    }
    DOCUMENT_SEQUENCES {
        uuid organization_id FK
        varchar kind
        int year
        bigint next_value
    }
    OUTBOX_EVENTS {
        uuid id PK
        uuid organization_id FK
        varchar event_type
        uuid aggregate_id
        jsonb payload
        int attempts
        timestamptz available_at
        timestamptz published_at
    }
```

Reporting Phase 4 đọc aggregate qua interface module và filter scope trước SUM/COUNT; chưa cần bảng materialized/copy dữ liệu. Outbox dispatcher SKIP LOCKED, retry bounded, event id làm idempotency ở consumer. Không coi delivery là exactly-once.

## CRM, Sales, Finance và outbox — schema Phase 3

```mermaid
erDiagram
    BRANCHES ||--o{ CUSTOMERS : owns
    BRANCHES ||--o{ SALES_ORDERS : owns
    WAREHOUSES ||--o{ SALES_ORDERS : snapshot
    CUSTOMERS ||--o{ SALES_ORDERS : buys
    SALES_ORDERS ||--o{ SALES_ORDER_ITEMS : contains
    PRODUCT_VARIANTS ||--o{ SALES_ORDER_ITEMS : snapshot_source
    SALES_ORDER_ITEMS |o--o{ STOCK_RESERVATIONS : order_item_id
    SALES_ORDERS ||--o{ SHIPMENTS : fulfills
    SHIPMENTS ||--o{ SHIPMENT_ITEMS : contains
    SALES_ORDER_ITEMS ||--o{ SHIPMENT_ITEMS : same_order
    SALES_ORDERS ||--o{ ORDER_EVENTS : history
    SALES_ORDERS ||--o{ PAYMENTS : receipts
    ORGANIZATIONS ||--o{ OUTBOX_EVENTS : publishes
    CUSTOMERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        varchar name
        varchar status
    }
    SALES_ORDERS {
        uuid id PK
        uuid organization_id FK
        uuid branch_id FK
        uuid warehouse_id FK
        uuid customer_id FK
        varchar order_number "org unique"
        varchar status
        decimal subtotal
        decimal discount_total
        decimal grand_total
        int version
    }
    SALES_ORDER_ITEMS {
        uuid id PK
        uuid organization_id FK
        uuid order_id FK
        uuid variant_id FK
        varchar sku "snapshot"
        varchar product_name "snapshot"
        decimal unit_price "snapshot"
        decimal quantity
        decimal delivered_quantity
        decimal line_total
    }
    SHIPMENTS {
        uuid id PK
        uuid organization_id FK
        uuid order_id FK
        varchar status "one DRAFT or POSTED per order"
        timestamptz posted_at
    }
    SHIPMENT_ITEMS {
        uuid id PK
        uuid shipment_id FK
        uuid order_id FK
        uuid order_item_id FK
        decimal quantity
    }
    ORDER_EVENTS {
        uuid id PK
        uuid order_id FK
        uuid actor_id FK
        varchar action
        jsonb payload
        timestamptz created_at
    }
    PAYMENTS {
        uuid id PK
        uuid sales_order_id FK
        decimal amount
        varchar method
        varchar external_reference "nullable, org-method unique"
        timestamptz received_at
    }
    OUTBOX_EVENTS {
        uuid id PK
        uuid organization_id FK
        uuid aggregate_id
        varchar status
        int attempts
        timestamptz locked_until
        uuid lock_token
        timestamptz available_at
        timestamptz published_at
    }
```

Mọi FK nghiệp vụ ghép organization; warehouse/customer của order còn ghép branch, shipment item ghép order để không gắn dòng của đơn khác. Reservation ACTIVE phải có order_item_id; lịch sử terminal Phase 2 có thể NULL. Header order và dòng snapshot bất biến sau confirm, trừ delivered_quantity được tăng khi CONFIRMED; order terminal, shipment committed, payment và order event được trigger bảo vệ. Tổng tiền/giá VND là Numeric(20,0), quantity Numeric(18,3); application vẫn phải kiểm tra tổng liên bảng, scope và trạng thái nghiệp vụ. Lease outbox phục vụ dispatcher #67 sau commit; schema không tự phát sự kiện hoặc gửi thông báo.
