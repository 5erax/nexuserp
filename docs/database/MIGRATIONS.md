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
- Seed tạo catalog 35 permission, và 5 role hệ thống/grant cho mỗi organization hiện có; chạy lại không nhân đôi. Không tạo organization/user/mật khẩu demo. Demo seed thuộc #78.
- Test tích hợp tự migrate database `_test`, tạo UUID riêng và dọn đúng dữ liệu đó; không dùng database giả.

Khi phát triển migration mới: dùng `pnpm --filter @nexus/api exec prisma migrate dev --name <name>` trên database dev có quyền tạo shadow database, review SQL rồi chạy deploy/diff trên database test trống. Không dùng `db push` hoặc sửa SQL migration đã áp dụng.

CHECK/trigger/index đặc biệt viết trực tiếp trong migration SQL. Baseline đã có CHECK trạng thái chi nhánh và VND. Prisma schema không biểu diễn đầy đủ các CHECK này, vì vậy drift check không thay thế test constraint trực tiếp trên PostgreSQL.

SQL baseline bọc trong transaction. Migration tiếp theo phải ghi rõ tác động dữ liệu và rollback plan; ưu tiên roll-forward. Không chạy DROP/RESET trên dữ liệu thật. Khôi phục từ backup hoặc revert migration chỉ thực hiện sau khi kiểm tra dữ liệu và schema tương thích.

Migration `20261015060000_iam` chỉ thêm bảng IAM, index và CHECK; không sửa/xóa dữ liệu organization/branch. Rollback ứng dụng có thể giữ các bảng chưa dùng; không DROP user/session để rollback code. Sửa lỗi schema bằng migration roll-forward đã review. Integration test kiểm tra email normalize, cấm mật khẩu thô, FK khác tổ chức, seed idempotent và successor refresh cùng family. Audit tới sau schema IAM. Thứ tự reservation theo [RESERVATION_MIGRATION_PLAN](RESERVATION_MIGRATION_PLAN.md).

Migration `20261016003000_catalog_inventory` chỉ thêm bảng, index, CHECK và trigger; không sửa dữ liệu IAM/audit. Chưa thêm FK tới Sales. Giá bán dùng Decimal(20,0), số lượng Decimal(18,3), giá nhập tùy chọn Decimal(20,6) theo ADR-0012. Ledger chặn UPDATE/DELETE; SKU có stock history không đổi được. Rollback ứng dụng giữ nguyên các bảng này; sửa schema bằng migration tiếp theo, không xóa ledger.

Hai partial unique index (kho mặc định đang hoạt động và tồn đầu kỳ) dùng preview `partialIndexes` của Prisma 7.10 đã ghim. Predicate raw giữ dạng PostgreSQL trả về khi introspect để drift check không tạo lại index tương đương. Khi nâng Prisma phải kiểm tra lại introspection/diff và các test constraint, không chỉ regenerate client.

Migration `20261016010000_idempotency` thêm bảng key/result, FK actor cùng tổ chức, unique scope và CHECK hash/expiry/state; không đổi dữ liệu hiện có. Giữ bảng khi rollback code để không mất lịch sử retry; không DROP cache thành công trong cửa sổ 24 giờ. Sửa schema bằng roll-forward. Chỉ prune key hết hạn, mỗi lần tối đa 100 dòng; unique business reference/terminal state vẫn phải bảo vệ command sau TTL.

Migration `20261016020000_reservation_reference` chỉ thêm index `(organization_id, reference_id)` cho truy vấn batch reserve/release/consume; không cập nhật hoặc xóa dữ liệu. Một câu CREATE INDEX là một transaction nguyên tử, khóa ghi trên bảng trong lúc xây index. Rollback code có thể giữ index; thay đổi bằng migration roll-forward, không sửa migration đã áp dụng. Chưa bổ sung FK Sales hoặc thay CHECK reservation Phase 2.

Migration `20261016023000_inventory_movement_reference` thêm index `(organization_id, reference_id)` trên movement để tra chứng từ khi không chọn loại. Không sửa dữ liệu ledger; một câu CREATE INDEX là transaction nguyên tử và khóa ghi trong lúc xây index. Có thể giữ index khi rollback ứng dụng; thay đổi tiếp bằng roll-forward.

Migration `20261016030000_adjustment_workflow` thêm decision_reason nullable, trạng thái chờ duyệt/từ chối, CHECK lý do từ chối và chi phí outbound NULL; không sửa/xóa dữ liệu. Nếu có dữ liệu cũ vi phạm CHECK mới, migration rollback nguyên transaction để điều tra bằng đối soát, không tự xóa hoặc sửa lịch sử. Trigger chặn UPDATE/DELETE phiếu POSTED và INSERT/UPDATE/DELETE dòng thuộc phiếu POSTED (kể cả chuyển dòng sang phiếu khác). Trigger khóa parent theo ID để tuần tự hóa sửa dòng và ghi sổ. Rollback ứng dụng phải giữ schema/lịch sử; bản cũ chưa hiểu trạng thái mới không được phục vụ command. Sửa lỗi bằng migration roll-forward đã review, không tắt trigger trên dữ liệu ứng dụng. Chỉ helper cleanup fixture `_test` khóa DDL và tắt/bật trigger trong cùng transaction khi dọn UUID do test sở hữu.
