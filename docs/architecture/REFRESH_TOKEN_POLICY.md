# Refresh token: rotation, tranh chấp và replay

Quyết định triển khai của [ADR-0010](../adr/0010-cookie-and-csrf-strategy.md), áp dụng cho #32, #34, #43 và #45. Mã server ở `apps/api/src/modules/iam/application/auth.service.ts`; `apps/api/test/auth.integration-spec.ts` kiểm tra rotation/revoke trên PostgreSQL thật, kể cả barrier khóa family, biên 5 giây, rollback khi audit lỗi và logout tranh chấp. Phía browser và admin reset/disable race được bổ sung trong các task IAM tiếp theo.

## Dữ liệu và transaction

- Một lần login tạo một family và một token hiện tại; nhiều thiết bị có family riêng. Bảng `refresh_families` có `expires_at` tuyệt đối và `revoked_at`; `refresh_sessions` có hash duy nhất, `family_id`, `rotated_at`, `replaced_by`. Family là khóa chung cho refresh/logout/revoke.
- Sau CSRF/Origin validation, tìm token bằng hash; khóa family trước, rồi token (`SELECT ... FOR UPDATE`), đọc lại trạng thái sau khi khóa. Mọi thao tác thu hồi/rotation phải cùng thứ tự khóa. Dùng giờ PostgreSQL (`clock_timestamp()` sau khi lấy khóa), không dùng timestamp client hay thời điểm bắt đầu transaction.
- Token ACTIVE hợp lệ chỉ tạo **một** successor trong transaction: ghi hash successor, đánh dấu token cũ đã xoay, ghi audit và commit. Sau commit mới trả 200 và đặt cookie mới. Lỗi trước commit rollback, token cũ còn dùng được.
- Thu hồi family và ghi audit phải commit trước khi trả lỗi 401. Không ném exception trong transaction khiến việc thu hồi bị rollback. Guard kiểm tra family còn hiệu lực ở mỗi request, bao gồm access JWT.

Login/đổi mật khẩu/quản trị user lấy organization rồi user bằng `FOR NO KEY UPDATE`, tiếp đó các family theo ID tăng dần; refresh/logout chỉ khóa family rồi token. Không dùng `FOR UPDATE` trên organization/user trong lúc chờ family: audit insert cần FK `KEY SHARE` trên hai parent này và có thể tạo deadlock ngược với refresh. Nếu quản trị đổi email/khóa unique, phải khóa/thu hồi family trước khi UPDATE user nâng mức khóa.

Giữ hash token cũ đến hạn tuyệt đối của family. Dọn family hết hạn cùng token theo chính sách lưu audit; không xóa dấu vết token cũ giữa phiên.

Lệnh vận hành `pnpm --filter @nexus/api sessions:prune` dọn tối đa 100 family đã hết hạn mỗi lần, khóa và kiểm tra lại clock database trước xóa session/family. Không xóa audit; không dọn token đã xoay của family còn hạn. Lệnh không tự chạy theo lịch ở MVP.

## Bảng kết quả bắt buộc

Thứ tự kiểm tra từ trên xuống. Cửa sổ tranh chấp cố định **5 giây**, tính từ `rotated_at` của token cũ, không gia hạn khi retry.

| Điều kiện sau khi khóa | HTTP / mã | Tác động |
| --- | --- | --- |
| Thiếu/sai CSRF hoặc Origin | 403 `CSRF_INVALID` | Không rotate/revoke, không đổi cookie |
| Không có token hợp lệ, family hết hạn/đã thu hồi, user không ACTIVE | 401 `SESSION_INVALID` | Không cấp token; xóa cookie của request không còn hợp lệ |
| Token hiện tại còn hiệu lực | 200 | Tạo một successor; cookie chỉ đổi ở response này |
| Token đã xoay, successor vẫn là token hiện tại và `0 <= now - rotated_at < 5s` | 409 `REFRESH_CONFLICT` | Không cấp token, không thu hồi family, không gửi `Set-Cookie` |
| Token đã xoay, đủ 5 giây hoặc successor cũng đã bị xoay | 401 `REFRESH_REUSE_DETECTED` | Thu hồi toàn bộ family và commit audit; không ảnh hưởng family thiết bị khác |

Không bao giờ trả token kế nhiệm cho người chỉ giữ token cũ. Không dùng IP/user-agent làm bằng chứng để cho phép replay. Không gắn middleware xóa cookie chung cho response 409 vì nó có thể ghi đè cookie từ request thắng.

## Phía trình duyệt

- Một promise refresh dùng chung trong tab; dùng Web Locks khi có để phối hợp các tab cùng origin, rồi thử lại request gốc trước khi quyết định cần refresh nữa. Không phát token qua BroadcastChannel/localStorage.
- Khi nhận 409, chờ promise/request thắng hoàn tất và thử lại request gốc đúng một lần bằng cookie hiện tại. Không tự gửi lại refresh với token cũ, không xóa phiên và không retry vô hạn. Nếu chưa có kết quả request thắng thì hiển thị lỗi có thể thử lại.
- Nếu response thắng bị mất sau commit, server không thể dựng lại refresh token từ hash. Người dùng có thể phải đăng nhập lại; client không tự retry refresh khi timeout. Đây là giới hạn được chấp nhận cho MVP.
- Logout idempotent theo family; logout với token vừa xoay vẫn thu hồi family đó. Khi logout tranh chấp refresh, family cuối cùng phải bị thu hồi dù response refresh có tới trễ.

## Kiểm thử bắt buộc trên PostgreSQL thật

| Ca | Kết quả mong đợi |
| --- | --- |
| Hai refresh cùng token, đồng bộ bằng barrier | Một 200, một 409; một successor; family còn dùng được |
| Replay tại +4.999s / +5.000s | Lần đầu 409; lần sau 401 và family bị thu hồi |
| Gửi lặp trong cửa sổ 5s | Không gia hạn `rotated_at`; không cấp thêm token |
| Dùng token T0 sau khi T1 đã xoay sang T2 | 401 và thu hồi family, kể cả còn trong 5s của T0 |
| Lỗi trước commit / mất response sau commit | Trước commit T0 còn hiệu lực; sau commit T0 không được cấp lại token |
| Logout/revoke tranh chấp refresh | Không còn access/refresh nào của family dùng được sau khi revoke commit |
| User bị khóa, reset password, family hết hạn | Thu hồi/khóa có hiệu lực ở cả access và refresh; không kéo dài hạn 7 ngày |
| Trả 401 vì replay rồi đọc bằng kết nối DB mới | `revoked_at` và audit đã commit; token successor bị từ chối |

Test biên dùng clock có thể điều khiển hoặc dữ liệu timestamp cố định trong transaction; test đồng thời dùng barrier/khóa, không dùng sleep để đoán race.

## Đánh đổi và nguồn tham khảo

Server không thể biết chắc request dùng token cũ là tab hợp lệ hay kẻ tấn công. Trong 5 giây, cả hai đều bị từ chối cấp token; việc thu hồi family được trì hoãn. Kẻ tấn công lấy được token đang ACTIVE vẫn có thể thắng rotation; chính sách này không giải quyết token theft hay XSS. Refresh hợp lệ bị trì hoãn quá 5 giây có thể làm người dùng phải đăng nhập lại.

[RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14.2) mô tả rotation và quan hệ token để phát hiện replay. Cửa sổ 5 giây và mã 409 là đánh đổi riêng của NexusERP; tài liệu không tuyên bố đây là cơ chế nhận diện kẻ tấn công hay chứng nhận tuân thủ OAuth.
