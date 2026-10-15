# ADR-0015: pnpm workspaces và Turborepo

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-15
- **Issue liên quan:** `P0-ADR-015` (#9)

## Bối cảnh và các lựa chọn

Monorepo có web, API và package dùng chung. npm workspaces dùng được nhưng hoisting dễ che dependency chưa khai báo; Nx thêm nhiều khái niệm hơn nhu cầu một người. Chọn pnpm workspaces và Turborepo để khai báo dependency và chạy task theo graph.

## Quyết định

- Workspace: `apps/*`, `packages/*`; giữ Node 22 theo `.nvmrc`. Không nâng runtime trong thay đổi tài liệu này.
- Issue #10 chọn bản phát hành pnpm/Turbo ổn định tương thích Node 22 tại thời điểm scaffold, ghim phiên bản cụ thể qua `packageManager` và dependency; không dùng `latest` trong cấu hình CI. Dùng Corepack được cài/ghim trong môi trường setup khi cần.
- Một `pnpm-lock.yaml` ở gốc; cài CI bằng `pnpm install --frozen-lockfile`. Package nội bộ dùng `workspace:*`, phải khai báo dependency trực tiếp.
- Script gốc: `dev`, `build`, `lint`, `typecheck`, `test`, `format`. `dev` là persistent và không cache; test có database/concurrency không cache. Chỉ cache task thuần với inputs/env/outputs khai báo đầy đủ.
- Không tạo helper, UI component hoặc module rỗng ngoài cấu trúc được issue yêu cầu. Tool kiểm tra import undeclared dependency và ranh giới module ở #10/#13.

## Hệ quả

Thêm hai công cụ nhưng có một lockfile và cách chạy thống nhất. Version cụ thể được khóa khi scaffold, không phải một quyết định kiến trúc đang chờ.

## Cách kiểm chứng

Issues #10, #15: máy sạch cài bằng lockfile, build/lint/typecheck chạy từ gốc và theo filter; undeclared import thất bại; lần build thứ hai cache hit; integration/concurrency test thực sự chạy lại.
