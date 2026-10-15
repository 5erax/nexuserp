# Quy tắc IAM

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| IAM-001 | Email đăng nhập phải duy nhất trong phạm vi tổ chức theo chính sách xác định trước | 1 | normalize + unique(organization_id,email) | apps/api/test/iam-schema.integration-spec.ts, auth.integration-spec.ts | Schema/login đã kiểm chứng |
| IAM-002 | Chỉ tài khoản ACTIVE mới được thực hiện nghiệp vụ | 1 | auth guard đọc user.status; UsersService thu hồi phiên khi disable/reset | apps/api/test/auth.integration-spec.ts, users.integration-spec.ts | Server đã kiểm chứng |
| IAM-003 | Mọi thao tác nghiệp vụ phải được kiểm tra permission tại Backend | 1 | permission guard deny default | apps/api/test/auth.integration-spec.ts (reflection,401/403), permission-catalog.spec.ts | Guard đã kiểm chứng |
| IAM-004 | Nhân viên chỉ được truy cập chi nhánh được cấp quyền | 1 | AccessScope, UsersService/OrganizationService lọc trước count; composite FK | apps/api/test/security.spec.ts, iam-schema.integration-spec.ts, users.integration-spec.ts; scripts/check-scope-mutation.cjs | IDOR/list/filter đã kiểm chứng; mutation bắt lỗi |
| IAM-005 | Hành động đặc quyền phải có audit trail | 1 | audit cùng transaction; che secret; GET audit-logs lọc scope | apps/api/test/audit.integration-spec.ts, auth.integration-spec.ts, users.integration-spec.ts | Ghi/rollback/query/cursor đã kiểm chứng |
| IAM-006 | Không được vô hiệu hóa quản trị viên hoạt động cuối cùng của tổ chức | 1 | UsersService khóa organization trước khi đếm admin ACTIVE | apps/api/test/users.integration-spec.ts (hai admin tự disable, gỡ role cuối) | Đã kiểm chứng trên PostgreSQL |
| IAM-007 | Refresh token phải hỗ trợ rotation và revocation | 1 | khóa family rồi session; hash unique; expiry tuyệt đối | apps/api/test/auth.integration-spec.ts (barrier,5s,replay,logout,rollback,expiry,prune), users.integration-spec.ts (disable/reset tranh chấp refresh) | Server đã kiểm chứng; browser ở #43 |
