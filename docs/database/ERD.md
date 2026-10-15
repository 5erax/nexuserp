# ERD triển khai — baseline Phase 0

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

Schema này khớp migration hiện có. #19 còn phải mở rộng ERD/data dictionary cho IAM, Inventory, Sales và Finance tối giản trước schema tương ứng; sơ đồ trong SRS là mô hình đích, không phải bảng đã triển khai.
