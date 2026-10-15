# Tài liệu NexusERP

Chỉ mục tài liệu của dự án. Nguồn sự thật về tiến độ là [GitHub Project](https://github.com/users/5erax/projects/5); nguồn sự thật về nghiệp vụ là các tài liệu dưới đây.

## Đã có

| Tài liệu | Nội dung |
| --- | --- |
| [product/SRS.md](product/SRS.md) | Đặc tả yêu cầu và kiến trúc (baseline v1.0): module, business rules, ERD, API, đồng thời, roadmap |
| [product/SCOPE.md](product/SCOPE.md) | Phạm vi MVP, ngoài phạm vi, giả định, tiêu chí thành công |
| [roadmap/PHASE_PLAN.md](roadmap/PHASE_PLAN.md) | Các phase, ước lượng, Definition of Done |
| [adr/README.md](adr/README.md) | ADR-0001–0015 đã ghi quyết định thiết kế |
| [architecture/SECURITY_ARCHITECTURE.md](architecture/SECURITY_ARCHITECTURE.md) | Baseline bảo mật; #42 bổ sung bằng chứng từ mã/test ở Phase 1 |
| [architecture/REFRESH_TOKEN_POLICY.md](architecture/REFRESH_TOKEN_POLICY.md) | Rotation, cửa sổ tranh chấp 5 giây, replay và test cases |
| [database/RESERVATION_MIGRATION_PLAN.md](database/RESERVATION_MIGRATION_PLAN.md) | Tách migration Inventory Phase 2 khỏi FK Sales Phase 3 |
| [development/SETUP.md](development/SETUP.md) | Cài dependency, Docker/local, chạy test và build |
| [development/CONFIGURATION.md](development/CONFIGURATION.md) | Biến môi trường và phạm vi secret |
| [development/DEPENDENCIES.md](development/DEPENDENCIES.md) | Override bảo mật và advisory tooling còn theo dõi |
| [architecture/SYSTEM_ARCHITECTURE.md](architecture/SYSTEM_ARCHITECTURE.md) | Luồng web → API → PostgreSQL đang triển khai |
| [architecture/MODULE_BOUNDARIES.md](architecture/MODULE_BOUNDARIES.md) | Module ownership và kiểm tra import trong CI |
| [database/ERD.md](database/ERD.md), [DATA_DICTIONARY.md](database/DATA_DICTIONARY.md) | Baseline organization/branch; #19 còn mở cho schema các phase sau |
| [database/MIGRATIONS.md](database/MIGRATIONS.md) | Generate, deploy, drift, test database và rollback plan |
| [api/openapi.yaml](api/openapi.yaml) | Contract health/readiness sinh từ NestJS |

## Sẽ được viết trong Phase 0

Mỗi tài liệu có issue riêng; đường dẫn dưới đây là đích dự kiến.

| Đường dẫn | Issue |
| --- | --- |
| `product/PRD.md`, `product/USER_STORIES.md` | `P0-DOC-005` |
| Mở rộng `database/ERD.md`, `database/DATA_DICTIONARY.md` cho Phase 1–3 | `P0-DB-002` |
| `business-rules/*.md` (IAM, Inventory, Sales, Purchasing, Finance) | `P0-DOC-004` |
| `business-rules/ORDER_STATE_MACHINE.md` | `P0-DOC-002` |
| `business-rules/PERMISSION_MATRIX.md` | `P0-DOC-003` |
| `api/API_CONVENTIONS.md` (pagination, command conventions) | `P0-DOC-006` |
| `testing/TEST_STRATEGY.md`, `testing/ACCEPTANCE_SCENARIOS.md` | `P0-DOC-007` |

## Quy ước

- Tài liệu viết bằng Markdown, ưu tiên sơ đồ Mermaid (GitHub hiển thị trực tiếp).
- Mỗi business rule có ID ổn định (`IAM-001`, `INV-002`, `SAL-007`, ...). Test tham chiếu ID này trong tên hoặc mô tả.
- Thay đổi hành vi nghiệp vụ phải cập nhật tài liệu trong cùng pull request.
