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

## Truy vết

[Các kịch bản](ACCEPTANCE_SCENARIOS.md) và bảng trong `business-rules/*_RULES.md` là kế hoạch, không phải kết quả pass. Khi có test, thay `planned:#issue` bằng đường dẫn và tên test đã chạy trong cùng PR. `pnpm docs:check` kiểm tra không thiếu/trùng rule SRS và mỗi issue Phase 1–4 được ánh xạ story.

Performance #77 công bố máy, dữ liệu, số kết nối, warmup và p50/p95/error rate: mục tiêu read<300ms, write<500ms không gồm tác vụ scrypt đăng nhập. Không tuyên bố đạt khi chưa đo. Production release cần audit không còn critical/high reachable và các control dữ liệu/bảo mật pass.
