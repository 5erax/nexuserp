# Dependency baseline — 15/10/2026

Phiên bản trực tiếp được ghim và dependency gián tiếp được khóa bằng `pnpm-lock.yaml`. Dùng pnpm frozen install trong CI; không dùng Prisma 8 prerelease hoặc TypeScript 7 khi bộ Nest/Jest hiện tại chưa được chọn cho các phiên bản đó.

## Vá gián tiếp có chủ đích

`package.json` có override giới hạn phạm vi cho js-yaml 4.3.2, mysql2 3.23.1, smol-toml 1.9.0 và KaTeX 0.18.2 để xử lý advisory hiện tại. Không ép js-yaml 3 sang major 4.

Riêng `@prisma/config > deepmerge-ts` dùng 8.0.2 vì [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). Đã đọc [release notes major 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0): Map merge thay đổi, nhưng cấu hình Prisma của dự án chỉ chứa object/string/function, không Map hoặc custom merger. Kiểm chứng lại generate, migrate deploy, diff và test PostgreSQL khi đổi override này. Gỡ override khi Prisma ổn định cập nhật dependency an toàn.

`pnpm audit:production` là gate chặn high/critical của dependency production. Full audit, kể cả tooling, được lưu thành artifact trong CI; không gọi bản full audit là sạch nếu còn advisory.

## Tooling còn advisory cần theo dõi

| Dependency | Advisory | Phạm vi và giới hạn hiện tại |
| --- | --- | --- |
| braces 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high, chưa có bản vá | Glob của ESLint/Jest/tooling, pattern do repo khai báo; không nhận glob từ HTTP/user. Không đưa dependency này vào xử lý input sản phẩm |
| sprintf-js | [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), moderate | Đường dependency tooling Jest/argparse; không nhận format string của người dùng trong API |

Đây là đánh giá phạm vi sử dụng hiện tại, không phải khẳng định thư viện an toàn. Rà lại mỗi PR Dependabot và trước mốc release #77; nếu chuyển tooling vào request path hoặc nhận pattern/format từ ngoài thì phải thay dependency hoặc chặn input trước khi ship. Không dùng `audit --ignore` để giấu advisory.
