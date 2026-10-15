# Từ điển dữ liệu — baseline Phase 0

IAM sở hữu hai bảng, chưa có API quản trị công khai.

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

Index unique tổ chức/mã chi nhánh và tổ chức/ID hỗ trợ scope và FK ghép cho schema sau. Không soft-delete baseline; API IAM ở Phase 1 triển khai deactivate theo business rule. #19 vẫn mở cho phần dictionary Phase 1–3 còn lại.
