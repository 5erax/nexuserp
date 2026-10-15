# Ranh giới module

Danh sách business module chuẩn: `iam`, `catalog`, `inventory`, `crm`, `sales`, `finance`, `reporting`, `audit`, `purchasing`, `hrm`. Đã có IAM, audit và module kỹ thuật health; không sinh thư mục nghiệp vụ rỗng.

- Presentation gọi application interface của module, không import Prisma/repository.
- Domain chỉ có quy tắc thuần, không import Nest/Prisma, infrastructure, application hoặc presentation.
- Module khác không import domain/infrastructure/presentation nội bộ; dùng API công khai của module hoặc application interface được công bố rõ ràng.
- Sales điều phối confirm trong một transaction rồi gọi Inventory qua interface; Inventory sở hữu reservation/movement/balance. Finance gọi Sales qua interface khi ghi sự kiện/kiểm tra trạng thái, không ghi bảng Sales.
- IAM sở hữu organization/branch/user/role. PrismaService là hạ tầng kết nối dùng chung, không phải quyền cho controller ghi mọi bảng.
- IAM công bố `application/access-scope.ts` cho module khác dùng Actor/scopeFilter/canGrant; không import domain IAM trực tiếp. AuditService công bố record(tx,input) để caller ghi audit trong transaction sở hữu thay đổi.

`pnpm boundaries` dùng dependency-cruiser để chặn cycle và các import sai ở trên. ESLint chặn import dependency chưa khai báo. Lint import không thể chứng minh ownership của câu SQL hoặc kiểm soát transaction; review/test vẫn phải kiểm tra việc đó.

API có `presentation / application / domain / infrastructure` khi phát sinh logic tương ứng. Health là module kỹ thuật, không tính vào 10 business module. Thư viện `packages/shared` chưa có utility vì chưa có nhu cầu dùng chung thực tế.
