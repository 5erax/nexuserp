# Kế hoạch hoàn thành NexusERP

Theo yêu cầu tiếp tục toàn bộ task ngày 15/10/2026. Task và acceptance criteria được quản lý tại [GitHub Issues](https://github.com/5erax/nexuserp/issues), không tạo backlog song song. Thực hiện lần lượt, mỗi phần phải qua kiểm tra trước khi gộp; chỉ đóng issue khi đã đạt acceptance.

## Thứ tự và điểm kiểm chứng

1. #82 → #83: sửa review, gộp nền tảng; giữ lịch sử tuyến tính. CI phải xanh, Compose kiểm tra credential đặc biệt.
2. Phase 0 #19, #21–26: hợp đồng dữ liệu, quyền, trạng thái, API, truy vết rule/story/test. #12, #14, #15: hoàn thiện UI toolkit, persistence/dev smoke, coverage và required checks.
3. Phase 1 #32 → #41 → #33–37 → #38–40 → #42–45: schema, audit, auth/CSRF/rotation, scope, quản trị, UI và security suite. Kiểm chứng bằng PostgreSQL thật, kể cả request đồng thời và IDOR.
4. Phase 2 #46–57: Catalog/Inventory, idempotency, ledger, reservation, điều chỉnh, reconciliation và UI. Mốc nghiệm thu: SKU cuối cùng không bị giữ hai lần, retry không nhân movement.
5. Phase 3 #58–70: CRM/Sales, giá snapshot, confirm/cancel/ship, Finance tối giản và outbox. Mốc nghiệm thu: order-to-ship với rollback khi thiếu một SKU, payment tranh chấp cancel, branch isolation.
6. Phase 4 #71–81: reports/export/audit UI, seed demo, E2E, quality gates, deployment và release. Deployment cần đích triển khai khả dụng; không ghi credential hoặc tạo chi phí ngoài yêu cầu.

Phase 5–6 (#7, #8) hiện chỉ là tracking định hướng, ngoài MVP theo SCOPE; chỉ chia task cụ thể sau khi Phase 4 đạt nghiệm thu. Không đánh dấu các phase này hoàn thành bằng placeholder.

## Rủi ro và cách xử lý

- Cookie/refresh và quyền quản trị là trust boundary: test từ chối trước test thành công; không mở CRUD chưa có guard.
- Thay đổi inventory và tiền phải dùng transaction, constraint, khóa nhất quán, idempotency và kiểm thử cạnh tranh.
- Không reset database dùng chung. Test tạo UUID riêng và chỉ dọn bản ghi của test.
- Windows chưa có Docker: dùng PostgreSQL local cho integration và Linux CI cho container; lưu bằng chứng CI trong PR.
- Dữ liệu và code đang chạy phải phân biệt với thiết kế đích: dictionary ghi rõ phase và tình trạng migration.
