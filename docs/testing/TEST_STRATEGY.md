# Chiến lược kiểm thử

## Cấp kiểm thử và lệnh

| Cấp | Công cụ/lệnh | Bằng chứng cần có |
| --- | --- | --- |
| Unit | Jest API, Vitest web; `pnpm test` | Policy tiền, trạng thái, scope, malformed input; tên test chứa rule ID khi liên quan |
| Integration | Jest + PostgreSQL 17; `pnpm test:integration` | Unique/FK/CHECK, rollback, seed lặp, query scope; không mock database |
| API E2E | Nest app + supertest cùng database test | Cookie/CSRF/permission và response contract thật |
| UI E2E | Playwright Chromium; `pnpm test:e2e` | Browser → proxy → API → database; keyboard, responsive 390/1024/1440, axe |
| Concurrency | Promise.all và barrier trong integration | Hai connection độc lập tranh cùng record, kiểm tra cả response và dữ liệu sau commit |
| Security | API + browser | IDOR, last admin race, replay, cookie flags, CSRF, mass assignment, CSV injection |
| Reliability | Integration fault injection | Rollback không để dư movement/reservation/outbox, replay không lặp effect |
| Operations | Linux CI Compose, migrate/drift, audit | Database trống, restart giữ dữ liệu, non-root, build reproducible, production audit |

Test database bắt buộc TEST_DATABASE_URL tên kết thúc `_test`; không fallback/reset schema. Data builder dùng UUID/mã riêng từng suite, tạo đủ organization/branch/actor, cleanup ngược FK chỉ bản ghi tự tạo. Suite đổi clock dùng clock SQL/tiêm thời gian có kiểm soát, không dùng sleep 5 giây cho mỗi refresh case. Test concurrency không thay timing production để né race.

## Chất lượng và độ tin cậy

Mục tiêu Phase 4: line coverage **80%** application/domain từng module có logic, loại generated/DTO/entrypoint. Chưa ép ngưỡng trên scaffold không có application/domain. Coverage artifact lưu cả unit và integration; coverage không thay test các nhánh bảo mật/race. Không dùng snapshot thay assertion business invariant.

Flaky test được xem là lỗi: giữ trace/seed/requestId, tái hiện đúng điều kiện, sửa root cause. CI retries=0, không skip test để xanh. Quarantine chỉ khi có issue cụ thể, owner, hạn tối đa 7 ngày và test thay thế cho hành vi quan trọng; không quarantine auth/tiền/overselling.

Kiểm tra chính xác sau mỗi phần thay đổi; chạy full CI trước merge. Không chạy lại cùng test nhiều lần trên code không đổi để tạo cảm giác chắc chắn. Khi test thất bại phải phân biệt server chưa chạy với lỗi ứng dụng, giữ log đủ điều tra nhưng không chứa secret.

## Inventory concurrency (#54)

`pnpm --filter @nexus/api test:inventory` migrate database `_test` rồi chạy `stock-concurrency.integration-spec.ts`. Suite có 20 vòng liên tiếp trong một process Jest, mỗi vòng dùng SKU/reference UUID mới và ba kịch bản (60 test cases):

- 100 application commands tranh 10 đơn vị: đúng 10 thành công, 90 lỗi `INSUFFICIENT_STOCK`; giải phóng một nửa và tiêu thụ một nửa, kiểm tra movement/số dư cuối.
- 10 command nhiều SKU có thứ tự dòng đảo nhau: tất cả giữ hàng rồi tiêu thụ thành công, không deadlock kéo dài.
- 100 lần thử cùng `Idempotency-Key`: chỉ một movement/key và một đơn vị tồn; các kết quả khác là committed replay hoặc `REQUEST_IN_PROGRESS`.

Sau mỗi trạng thái đã commit, suite gọi ReconciliationService để so sánh ledger và reservation ACTIVE với cả hai số dư. Dữ liệu đúng phải có total=0; không chỉ kiểm tra HTTP/Promise thành công. Các tác vụ song song được đợi kết thúc trước assert/cleanup; không dùng sleep để tạo race, không đổi pool/transaction timeout hoặc tắt CHECK/FK. Timeout test là 30 giây mỗi kịch bản. Coverage riêng của lệnh focused ở `apps/api/coverage/inventory`, không ghi đè coverage full integration.

`pnpm --filter @nexus/api test:inventory:mutation` tạm bỏ đúng một điều kiện `on_hand - reserved >= quantity`, chạy ca 100 contenders của vòng đầu, yêu cầu thất bại ở assertion mã lỗi rồi khôi phục đúng nội dung source trong finally. CHECK PostgreSQL vẫn bảo vệ reserved<=on_hand, nên lỗi hồi quy là P2010 thay cho 409 `INSUFFICIENT_STOCK`; không tuyên bố mutation tạo overselling khi lớp CHECK vẫn hoạt động. Log nằm ở `apps/api/coverage/stock-mutation.log`. Chạy focused/full integration trước mutation để migrate test database; không chạy script trên checkout đang phục vụ dev server hoặc song song một test/build khác.

Full integration/foundation CI bao gồm đủ 20 vòng; quality job chạy thêm mutation và giữ log trong artifact coverage. Kết quả cục bộ đầu tiên: 60/60 cases qua, mutation bị phát hiện và source được khôi phục. Đây là kiểm chứng application concurrency trên PostgreSQL thật, không phải số đo p95 của API/HTTP (#77). Khi #58 thêm Sales FK/CHECK, fixture ACTIVE phải chuyển sang dòng đơn thật theo kế hoạch migration, không tắt constraint để giữ test xanh.

## Truy vết

[Các kịch bản](ACCEPTANCE_SCENARIOS.md) và bảng trong `business-rules/*_RULES.md` là kế hoạch, không phải kết quả pass. Khi có test, thay `planned:#issue` bằng đường dẫn và tên test đã chạy trong cùng PR. `pnpm docs:check` kiểm tra không thiếu/trùng rule SRS và mỗi issue Phase 1–4 được ánh xạ story.

Performance #77 công bố máy, dữ liệu, số kết nối, warmup và p50/p95/error rate: mục tiêu read<300ms, write<500ms không gồm tác vụ scrypt đăng nhập. Không tuyên bố đạt khi chưa đo. Production release cần audit không còn critical/high reachable và các control dữ liệu/bảo mật pass.
