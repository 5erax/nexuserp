# Chính sách bảo mật

## Phiên bản được hỗ trợ

NexusERP đang ở giai đoạn trước phát hành. Chỉ nhánh `main` nhận bản vá bảo mật. Sau khi có bản phát hành đầu tiên, bảng dưới đây sẽ liệt kê các phiên bản được hỗ trợ.

| Phiên bản | Hỗ trợ |
| --- | --- |
| `main` | Có |

## Báo cáo lỗ hổng

**Không** mở issue công khai cho lỗ hổng bảo mật.

Hãy dùng tính năng báo cáo riêng tư của GitHub: vào tab **Security** của repository, chọn **Report a vulnerability** (hoặc mở [trang báo cáo trực tiếp](https://github.com/5erax/nexuserp/security/advisories/new)).

Vui lòng cung cấp:

- Mô tả lỗ hổng và tác động có thể xảy ra.
- Các bước tái hiện, hoặc proof of concept tối thiểu.
- Phiên bản hoặc commit bị ảnh hưởng.
- Gợi ý khắc phục, nếu có.

## Quy trình xử lý

Đây là dự án cá nhân, không có SLA chính thức. Mục tiêu hợp lý:

- Xác nhận đã nhận báo cáo trong vòng 7 ngày.
- Đánh giá mức độ nghiêm trọng và phản hồi kế hoạch xử lý.
- Phát hành bản vá, sau đó công bố advisory và ghi nhận người báo cáo (nếu họ đồng ý).

## Phạm vi

Trong phạm vi: mã nguồn trong repository này, cấu hình Docker và workflow CI.

Ngoài phạm vi: lỗ hổng của thư viện bên thứ ba (hãy báo cho dự án đó), tấn công từ chối dịch vụ bằng lưu lượng lớn, social engineering.

## Lưu ý về dữ liệu

Môi trường demo chỉ dùng dữ liệu mẫu. Không đưa dữ liệu thật hoặc thông tin cá nhân vào repository, issue hay môi trường demo.
