# Kiểm chứng CI và Docker — 16/10/2026

PR [#92](https://github.com/5erax/nexuserp/pull/92) đã dùng bốn revision lỗi có chủ đích để kiểm chứng required check `quality`. Mỗi revision chỉ chứa một loại lỗi; lỗi được gỡ trước khi chuyển sang ca tiếp theo. GitHub báo `mergeStateStatus=BLOCKED` ở cả bốn ca. Revision cuối khôi phục workflow và không giữ file probe lỗi.

| Ca kiểm chứng | Revision | Bước thất bại thực tế | Run |
| --- | --- | --- | --- |
| Lint | d4a7119 | pnpm lint: biến unusedProbe không được dùng | [38776041987](https://github.com/5erax/nexuserp/actions/runs/38776041987) |
| Kiểu dữ liệu | 5d245b0 | pnpm typecheck: TS2322, number không gán được cho string | [38776335777](https://github.com/5erax/nexuserp/actions/runs/38776335777) |
| Unit test | 0cb95d0 | pnpm test: assertion expect(1).toBe(2) thất bại | [38776644611](https://github.com/5erax/nexuserp/actions/runs/38776644611) |
| Migration drift | ee25913 | db:check phát hiện cột ci_gate_probe dư, exit code 2 | [38777350467](https://github.com/5erax/nexuserp/actions/runs/38777350467) |

Ca drift chỉ ALTER database PostgreSQL service tạm trong CI sau khi migrate. Không thay database ứng dụng/local và không thay schema để né gate. Các commit lỗi là lịch sử thử nghiệm; PR được squash khi merge để main chỉ nhận thay đổi hợp lệ.

## Đo thời gian và môi trường sạch

Baseline hợp lệ [38775586166](https://github.com/5erax/nexuserp/actions/runs/38775586166), revision f0a3c16: quality 2 phút 26 giây; security 1 phút 1 giây; containers 1 phút 36 giây; dev-containers 1 phút 16 giây. Các job chạy song song trên runner Ubuntu sạch, đều dưới mục tiêu 10 phút. Đây là một lần đo, không phải cam kết thời gian cho mọi run.

Job containers build production profile, kiểm tra readiness qua ingress, user non-root API/web/edge, proxy spoof isolation và dữ liệu PostgreSQL còn sau restart. Job dev-containers build profile dev rồi sửa source trên host: cả Next và Nest phải trả response mới trong 60 giây mà không rebuild. Probe khôi phục nguyên bytes và giữ Compose log dưới artifact development-container-diagnostics. Docker được kiểm chứng trên Linux CI; máy Windows local chưa có Docker.

Lần đầu [38774884004](https://github.com/5erax/nexuserp/actions/runs/38774884004) phát hiện Nest watch để lại Node cũ giữ cổng 3001 trên image slim. Script dev dùng `nest start --watch --no-shell` để CLI quản lý Node trực tiếp; baseline xanh ở trên đã kiểm chứng lại cả hai ứng dụng.

## Các gate được duy trì

Workflow dùng Node từ .nvmrc, pnpm frozen lockfile, token contents:read và concurrency hủy run cũ. Quality chạy lint/boundaries, format/docs, typecheck, unit/integration, migrate/drift, contracts, audit production, build và Playwright. Security chạy kiểm thử auth/scope và mutation checks riêng. Artifact foundation-diagnostics giữ coverage, browser report và full dependency audit; tooling advisory còn lại được ghi ở [DEPENDENCIES](DEPENDENCIES.md).

Main yêu cầu Conventional PR title, Markdown lint, quality, containers và security. Sau khi workflow dev-containers được merge và chạy xanh, thêm check này vào bảo vệ nhánh, giữ nguyên các check cũ. Khi đổi workflow hoặc protection, chạy lại các ca âm nếu thay đổi có thể làm gate bỏ lọt lỗi.
