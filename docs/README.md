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
| [development/CATALOG.md](development/CATALOG.md) | API sản phẩm/SKU, trạng thái lưu trữ và kiểm thử Phase 2 |
| [development/INVENTORY.md](development/INVENTORY.md) | Ledger nguyên tử, quyền sở hữu số dư và kiểm thử đồng thời |
| [development/CRM.md](development/CRM.md) | Hồ sơ khách hàng, contact dùng chung, archive và lịch sử đơn theo quyền Sales |
| [development/OUTBOX.md](development/OUTBOX.md) | Claim/retry/lease, consumer idempotent và runbook sự kiện sau commit |
| [development/CONFIGURATION.md](development/CONFIGURATION.md) | Biến môi trường và phạm vi secret |
| [development/DEPENDENCIES.md](development/DEPENDENCIES.md) | Override bảo mật và advisory tooling còn theo dõi |
| [architecture/SYSTEM_ARCHITECTURE.md](architecture/SYSTEM_ARCHITECTURE.md) | Luồng web → API → PostgreSQL đang triển khai |
| [architecture/MODULE_BOUNDARIES.md](architecture/MODULE_BOUNDARIES.md) | Module ownership và kiểm tra import trong CI |
| [database/ERD.md](database/ERD.md), [DATA_DICTIONARY.md](database/DATA_DICTIONARY.md) | Baseline hiện có và thiết kế đích Phase 1–4, constraint/FK/index và ownership |
| [database/MIGRATIONS.md](database/MIGRATIONS.md) | Generate, deploy, drift, test database và rollback plan |
| [api/openapi.yaml](api/openapi.yaml) | Contract REST sinh từ NestJS |

## Hợp đồng Phase 0

Các tài liệu dưới đây đã có; trạng thái triển khai/test thực tế được ghi riêng, không coi thiết kế đích là chức năng đã chạy.

| Đường dẫn | Issue |
| --- | --- |
| [PRD](product/PRD.md), [user stories](product/USER_STORIES.md) | #24 |
| [ERD](database/ERD.md), [dictionary](database/DATA_DICTIONARY.md) | #19 |
| [IAM](business-rules/IAM_RULES.md), [Inventory](business-rules/INVENTORY_RULES.md), [Sales](business-rules/SALES_RULES.md), [Purchasing](business-rules/PURCHASING_RULES.md), [Finance](business-rules/FINANCE_RULES.md) | #23 |
| [State machine](business-rules/ORDER_STATE_MACHINE.md) | #21 |
| [Permission matrix](business-rules/PERMISSION_MATRIX.md) | #22 |
| [API conventions](api/API_CONVENTIONS.md) | #25 |
| [Test strategy](testing/TEST_STRATEGY.md), [acceptance scenarios](testing/ACCEPTANCE_SCENARIOS.md) | #26 |

## Quy ước

- Tài liệu viết bằng Markdown, ưu tiên sơ đồ Mermaid (GitHub hiển thị trực tiếp).
- Mỗi business rule có ID ổn định (`IAM-001`, `INV-002`, `SAL-007`, ...). Test tham chiếu ID này trong tên hoặc mô tả.
- Thay đổi hành vi nghiệp vụ phải cập nhật tài liệu trong cùng pull request.
