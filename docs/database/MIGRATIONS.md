# Schema baseline và migration

Prisma 7.10.0 dùng `prisma.config.ts` cho URL, generator `prisma-client` và PostgreSQL adapter. Client sinh vào `apps/api/src/generated/prisma`, không commit. Schema và SQL migration được commit cùng nhau.

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm db:check
```

- `db:migrate` là `prisma migrate deploy`, chạy trên database trống và chạy lại no-op.
- `db:check` so sánh database hiện tại với `schema.prisma`, trả mã lỗi khi drift.
- Seed Phase 0 không tạo dữ liệu demo hoặc tài khoản. Demo seed thuộc #78.
- Test tích hợp tự migrate database `_test`, tạo UUID riêng và dọn đúng dữ liệu đó; không dùng database giả.

Khi phát triển migration mới: dùng `pnpm --filter @nexus/api exec prisma migrate dev --name <name>` trên database dev có quyền tạo shadow database, review SQL rồi chạy deploy/diff trên database test trống. Không dùng `db push` hoặc sửa SQL migration đã áp dụng.

CHECK/trigger/index đặc biệt viết trực tiếp trong migration SQL. Baseline đã có CHECK trạng thái chi nhánh và VND. Prisma schema không biểu diễn đầy đủ các CHECK này, vì vậy drift check không thay thế test constraint trực tiếp trên PostgreSQL.

SQL baseline bọc trong transaction. Migration tiếp theo phải ghi rõ tác động dữ liệu và rollback plan; ưu tiên roll-forward. Không chạy DROP/RESET trên dữ liệu thật. Khôi phục từ backup hoặc revert migration chỉ thực hiện sau khi kiểm tra dữ liệu và schema tương thích.

Baseline hiện chỉ có organization/branch. ERD và từ điển đầy đủ Phase 1–3 vẫn thuộc #19. Thứ tự reservation theo [RESERVATION_MIGRATION_PLAN](RESERVATION_MIGRATION_PLAN.md).
