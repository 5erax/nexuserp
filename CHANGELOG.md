# Changelog

Mọi thay đổi đáng chú ý của dự án được ghi lại ở đây. Định dạng theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), phiên bản theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Unreleased]

### Added

- Khởi tạo repository: tài liệu đặc tả SRS, ADR 0001–0009, kế hoạch phase, quy trình đóng góp, issue/PR templates và kiểm tra tự động cho tài liệu.
- ADR 0010–0015, baseline bảo mật, chính sách refresh token đồng thời/replay và kế hoạch migration reservation qua Phase 2–3.
- Nền tảng chạy được: pnpm/Turbo monorepo, NestJS health/readiness và OpenAPI client, Next.js shell/trạng thái UI, Prisma/PostgreSQL baseline organization/branch, Docker profiles, CI và bộ test nền tảng.

### Changed

- Thống nhất 10 module, phạm vi Phase 0–6 và API sau MVP; Finance tối giản chỉ ghi nhận thanh toán thủ công từ Phase 3. Costing/lợi nhuận hoãn tới Phase 5.
