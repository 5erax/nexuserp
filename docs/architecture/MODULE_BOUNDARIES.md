# Ranh giới module

Danh sách business module chuẩn: `iam`, `catalog`, `inventory`, `crm`, `sales`, `finance`, `reporting`, `audit`, `purchasing`, `hrm`. Đã có IAM, audit, Catalog, Inventory, nền CRM/Sales và interface đọc khoản thu; không sinh thư mục nghiệp vụ rỗng hoặc coi interface đọc là đã có API thanh toán.

- Presentation gọi application interface của module, không import Prisma/repository.
- Domain chỉ có quy tắc thuần, không import Nest/Prisma, infrastructure, application hoặc presentation.
- Module khác không import domain/infrastructure/presentation nội bộ; dùng API công khai của module hoặc application interface được công bố rõ ràng.
- Sales điều phối confirm trong một transaction rồi gọi Inventory qua interface; Inventory sở hữu reservation/movement/balance. Finance gọi Sales qua interface khi ghi sự kiện/kiểm tra trạng thái, không ghi bảng Sales.
- IAM sở hữu organization/branch/user/role. PrismaService là hạ tầng kết nối dùng chung, không phải quyền cho controller ghi mọi bảng.
- IAM công bố `application/access-scope.ts` cho module khác dùng Actor/scopeFilter/canGrant; không import domain IAM trực tiếp. AuditService công bố record(tx,input) để caller ghi audit trong transaction sở hữu thay đổi.

`pnpm boundaries` dùng dependency-cruiser để chặn cycle và các import sai ở trên. ESLint chặn import dependency chưa khai báo. Lint import không thể chứng minh ownership của câu SQL hoặc kiểm soát transaction; review/test vẫn phải kiểm tra việc đó.

Sales DRAFT chỉ query persistence của orders/items/shipments/events. Catalog công bố `CatalogService.lockActiveVariants(tx, org, ids)` trả snapshot chuỗi và giữ SHARE lock trên metadata/giá; CRM công bố `CustomerDirectoryService.lockActive` và batch `names` (kể cả khách INACTIVE cho lịch sử). `CustomerDirectoryModule` là module đọc độc lập, không import Sales; CRM workspace có thể gọi Sales để lấy history mà không tạo vòng dependency. Inventory công bố `WarehousesService.lockDefault` và `ReservationsService.hasForOrder`; Finance công bố `PaymentReadsService.hasForOrder`. Không trả Prisma model riêng của owner qua các interface này.

IAM công bố `AuthService.lockActor` để khóa organization và đọc lại actor, `OrganizationService.lockBranch/businessYear` cho scope/niên độ. Các helper khóa yêu cầu caller transaction; số SO cấp qua helper nền tảng `common/sales-order-number.ts` trong cùng transaction. Test `module-read-ownership.spec.ts` chặn các bypass ORM/SQL từ Sales/CRM sang bảng module khác; integration kiểm tra gọi nhầm root client bị từ chối, cùng các hành vi scope/snapshot/concurrency thực tế.

API có `presentation / application / domain / infrastructure` khi phát sinh logic tương ứng. Health và outbox là module kỹ thuật, không tính vào 10 business module. Outbox công bố add(tx,event) cho producer; claim/lease/receipt thuộc chính outbox, không có controller công khai. Thư viện `packages/shared` chưa có utility vì chưa có nhu cầu dùng chung thực tế.

## Dùng scope ở module tiếp theo

Lấy Actor từ AuthorizedRequest, không lấy organization/user/branch access từ body hoặc header tự khai. Application import scopeFilter từ IAM application/access-scope.ts rồi AND scope với điều kiện id, branchId và các filter nghiệp vụ; không ghi đè scope bằng object spread từ query. Catalog chỉ có ORG; Inventory dùng branchId; Sales OWN còn dùng createdBy. Khi chọn chi nhánh làm việc bằng query/body, branchId chỉ thu hẹp phạm vi đã được cấp. List áp scope trước count/pagination; detail/command không tìm thấy trong scope trả 404. Helper không thay thế kiểm tra trạng thái và recheck authority trong transaction ghi.
