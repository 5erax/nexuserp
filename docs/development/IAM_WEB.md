# Giao diện IAM

Phạm vi #12/#43/#44: dùng tokens và shell hiện có, nội dung tiếng Việt, không đổi nhận diện. Form một cột, label luôn hiển thị, lỗi có role alert và requestId, nút submit hiển thị đang xử lý. Bảng quản trị có tìm kiếm, sắp xếp/phân trang phía server, loading/empty/error và xác nhận trước vô hiệu hóa/reset. 390px dùng cuộn bảng trong vùng riêng, không làm trang tràn ngang.

Phiên khởi tạo qua me, cookie là nguồn xác thực. Query không tự retry lỗi phiên/refresh. Transport dùng client sinh từ OpenAPI, CSRF đọc từ cookie hiện tại; bootstrap khi thiếu. Sau 401 dùng một promise trong tab và Web Locks khi có: dưới lock thử request gốc trước khi refresh, rồi thử request gốc một lần sau refresh. 409 không xóa phiên/cookie, chỉ chờ ngắn và thử request gốc một lần; timeout refresh yêu cầu người dùng thử lại, không tự gửi lại token cũ. Không lưu token vào localStorage/BroadcastChannel.

Trang bảo vệ chuyển về login với đường dẫn nội bộ để quay lại; không chấp nhận URL ngoài origin. mustChangePassword đưa tới đổi mật khẩu, thành công thu hồi phiên và yêu cầu login lại. Menu dựa trên grants hiện tại chỉ phục vụ trải nghiệm; backend vẫn quyết định permission/scope.

Các trang /admin/users, /admin/roles, /admin/branches, /admin/organization dùng API thật. Bảng dùng chung DataTable có trạng thái và phân trang phía server; tìm kiếm chỉ gửi khi submit, không phát request theo từng phím. Trình gán role/chi nhánh có tải thêm, giữ lựa chọn ở các trang chưa tải để không vô tình xóa quyền. Giới hạn API là 10 role và 100 chi nhánh mỗi user. System role chỉ xem; custom role sửa grant theo nhóm module. Disable/reset và ngừng chi nhánh dùng native dialog, hỗ trợ Escape/focus của browser và khóa thao tác khi đang lưu.

Kiểm chứng: user-form.test.tsx giữ assignment ngoài trang lookup đầu; data-table.test.tsx kiểm tra pagination và không hiển thị cached rows khi lỗi; e2e/admin.spec.ts tạo chi nhánh → role → nhân viên → login bằng nhân viên, kiểm tra branch scope, 403, admin cuối, chi nhánh còn nhân viên, disable/revoke, reset và hồ sơ tổ chức. Axe và màn hình 390px nằm trong luồng này. Không coi kiểm thử IAM là nghiệm thu Catalog/Inventory/Sales.

Tham chiếu: [ADR-0010](../adr/0010-cookie-and-csrf-strategy.md), [refresh policy](../architecture/REFRESH_TOKEN_POLICY.md), [shadcn monorepo](https://ui.shadcn.com/docs/monorepo), [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
