# Hướng dẫn đóng góp

Tài liệu này mô tả cách làm việc trong NexusERP. Dự án được phát triển như một sản phẩm thật: mọi thay đổi đi qua issue, branch, pull request và kiểm tra tự động, kể cả khi chỉ có một người tham gia.

## Nguyên tắc

1. **Issue trước, code sau.** Mọi công việc có issue với mục tiêu, acceptance criteria và test cases.
2. **Quyết định kiến trúc được ghi lại** bằng ADR trong [`docs/adr/`](docs/adr/README.md).
3. **Quy tắc nghiệp vụ nằm ở backend** và có kiểm thử tự động. Ẩn nút ở frontend không phải là kiểm soát.
4. **Thay đổi nhỏ, tích hợp thường xuyên.** Một PR giải quyết một issue.

## Quy ước đặt tên issue

Định dạng `P<phase>-<AREA>-<số>`, ví dụ `P2-INV-002 Atomic Reservations`.

| AREA | Ý nghĩa |
| --- | --- |
| ARC, DEV, DB, OPS, PLT | Kiến trúc, developer experience, database, vận hành, nền tảng dùng chung |
| DOC, ADR | Tài liệu, quyết định kiến trúc |
| AUTH, IAM, AUD | Xác thực, phân quyền, audit |
| CAT, INV, CRM, SAL, OBX | Catalog, tồn kho, khách hàng, bán hàng, outbox |
| RPT, EXP | Báo cáo, export |
| WEB | Giao diện |
| TST, REL | Kiểm thử, phát hành |

Labels dùng các nhóm `phase:*`, `type:*`, `area:*`, `priority:*`, `size:*` và `status:*`.

## Quy trình làm việc

1. Chọn issue từ cột **Ready** của GitHub Project; chuyển sang **In progress**.
2. Tạo branch từ `main`: `<type>/<id>-<slug>`, ví dụ `feat/p2-inv-002-atomic-reservations`.
3. Code, viết test, cập nhật tài liệu và OpenAPI contract nếu API thay đổi.
4. Chạy kiểm tra cục bộ (lint, typecheck, test) trước khi push.
5. Mở pull request, điền đầy đủ template, liên kết issue bằng `Closes #<số>`.
6. CI phải xanh; tự review diff một lần nữa trước khi merge.
7. Merge bằng **squash merge**. Branch được xóa tự động.

## Commit và tiêu đề PR

Dùng [Conventional Commits](https://www.conventionalcommits.org/). Tiêu đề PR là thông điệp commit sau khi squash, nên CI kiểm tra định dạng này.

```text
<type>(<scope>): <mô tả ngắn, thể hiện hành động>

feat(inventory): reserve stock with conditional update
fix(sales): reject confirm when order is not DRAFT
docs(adr): record cookie and CSRF strategy
```

Các `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. `scope` thường là tên module (`iam`, `catalog`, `inventory`, `sales`, `web`, `api`, `db`).

## Definition of Done (áp dụng cho mọi issue)

- [ ] Acceptance criteria của issue được đáp ứng.
- [ ] Có kiểm thử cho hành vi mới; quy tắc nghiệp vụ quan trọng có test tự động.
- [ ] Lint, typecheck và toàn bộ test pass trong CI.
- [ ] Endpoint mới hoặc thay đổi đã cập nhật OpenAPI contract.
- [ ] Thay đổi database có migration, kiểm tra được trên database trống.
- [ ] Quyền truy cập và phạm vi chi nhánh đã được kiểm tra ở backend.
- [ ] Tài liệu liên quan (`docs/`, README, ADR) được cập nhật.
- [ ] Không có secret, dữ liệu thật hoặc cấu hình riêng tư trong commit.

## Thay đổi kiến trúc

Nếu thay đổi chạm vào ranh giới module, mô hình dữ liệu cốt lõi, bảo mật hoặc một quyết định đã có ADR: mở issue loại `decision`, viết ADR mới (hoặc ADR thay thế), được chấp nhận trước khi merge code phụ thuộc vào nó.

## Môi trường phát triển

Phiên bản Node.js: xem [`.nvmrc`](.nvmrc). Dùng pnpm workspaces và Turborepo theo [ADR-0015](docs/adr/0015-package-manager-and-monorepo-tooling.md); phiên bản cụ thể được ghim khi scaffold (#10). Hướng dẫn cài đặt đầy đủ sẽ có ở README khi issue `P0-DEV-001` hoàn thành.

## Bảo mật

Không mở issue công khai cho lỗ hổng bảo mật. Xem [SECURITY.md](SECURITY.md).
