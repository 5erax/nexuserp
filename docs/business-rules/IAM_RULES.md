# Quy tắc IAM

Nguồn [SRS](../product/SRS.md), các ADR đã Accepted và [ma trận quyền](PERMISSION_MATRIX.md). Mỗi ID SRS chỉ xuất hiện một lần ở cột ID trong bộ tài liệu này. `planned:#issue` là kế hoạch kiểm thử, không phải đã triển khai.

| ID | Phát biểu | Phase | Nơi thực thi | Test tham chiếu | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| IAM-001 | Email đăng nhập phải duy nhất trong phạm vi tổ chức theo chính sách xác định trước | 1 | normalize + unique(organization_id,email) | planned:#32, planned:#33 | Chưa triển khai |
| IAM-002 | Chỉ tài khoản ACTIVE mới được thực hiện nghiệp vụ | 1 | auth guard kiểm tra user.status trên mỗi request | planned:#33, planned:#38 | Chưa triển khai |
| IAM-003 | Mọi thao tác nghiệp vụ phải được kiểm tra permission tại Backend | 1 | permission guard deny default | planned:#36, planned:#45 | Chưa triển khai |
| IAM-004 | Nhân viên chỉ được truy cập chi nhánh được cấp quyền | 1 | AccessScope và composite organization FK | planned:#37, planned:#45 | Chưa triển khai |
| IAM-005 | Hành động đặc quyền phải có audit trail | 1 | audit cùng transaction; payload allowlist | planned:#41, planned:#45 | Chưa triển khai |
| IAM-006 | Không được vô hiệu hóa quản trị viên hoạt động cuối cùng của tổ chức | 1 | khóa organization rồi đếm admin ACTIVE | planned:#38, planned:#45 | Chưa triển khai |
| IAM-007 | Refresh token phải hỗ trợ rotation và revocation | 1 | khóa family rồi session; hash unique; expiry tuyệt đối | planned:#34, planned:#45 | Chưa triển khai |
