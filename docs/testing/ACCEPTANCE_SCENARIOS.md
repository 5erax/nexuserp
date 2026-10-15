# Kịch bản nghiệm thu dự kiến

Đây là Given/When/Then cho test sẽ triển khai; không phải báo cáo kết quả. Tên rule đối chiếu bảng traceability trong `business-rules/*_RULES.md`.

## Demo bảy bước

1. Given Owner ACTIVE, When tạo A/B và cấp nhân viên Sales chỉ A, Then user/role/branch access cùng tổ chức, có audit, B không hiện với nhân viên (IAM-002–005; #38–40).
2. Given kho A ACTIVE và 100 SKU mới, When mở tồn đầu kỳ có lý do, Then mỗi SKU có balance/movement OPENING, chạy lặp key không tăng tồn lần hai (INV-001, INV-003–005, INV-007–008, INV-010; #48–51).
3. Given Sales A có OWN, When tạo và confirm đơn đủ hàng, Then snapshot tên/giá/kho, tổng VND HALF_UP, reservation ACTIVE đủ mọi dòng (SAL-001–004, SAL-006–007, SAL-010; #60–62).
4. Given available=1, When hai đơn khác nhau confirm cùng lúc quantity=1, Then đúng một thành công, một INSUFFICIENT_STOCK; reserved=1 và không âm (INV-002–004; #54, #62).
5. Given đơn CONFIRMED giữ đủ hàng, When Warehouse A tạo/post shipment đủ một lần, Then on_hand và reserved cùng giảm, reservation CONSUMED, order FULFILLED; post lại không có movement mới (SAL-008, INV-004–005; #63).
6. Given đơn đã giao và payment thủ công hợp lệ, When Manager xem report theo A, Then doanh thu theo đơn giao khác số đã thu, sum ledger khớp tồn và audit có requestId; không có dữ liệu B (FIN-001–003; #65, #71–74).
7. Given Sales chỉ A, When gọi trực tiếp GET/PATCH/confirm đơn B bằng UUID thật hoặc filter branchId=B, Then detail 404, list không lộ count; thiếu permission độc lập trả 403 (IAM-003–004; #45, #70, #76).

## Các tình huống bắt buộc bổ sung

| Rule | Given / When / Then | Test issue |
| --- | --- | --- |
| IAM-001 | Cùng tổ chức, email khác hoa/thường → insert/login chuẩn hóa; duplicate bị unique chặn. Tổ chức khác được phép cùng email | #32, #33 |
| IAM-002 | User bị LOCKED/INACTIVE hoặc family revoked → access hiện có và refresh đều thất bại ngay | #33, #34, #38 |
| IAM-005 | Mutation bị rollback → không có audit thành công; mutation commit → audit trong cùng transaction, không password/token | #41 |
| IAM-006 | Hai admin đồng thời bỏ quyền/disable chính mình → còn ít nhất một admin ACTIVE sau cả hai transaction | #38, #45 |
| IAM-007 | Hai refresh cùng token → một successor, một 409 không Set-Cookie; ≥5s hoặc successor đã rotate → revoke commit rồi401; logout đua refresh không hồi sinh phiên | #34, #45 |
| INV-007 | Tổng abs delta=10 có lý do → post; =10.001 → APPROVAL_REQUIRED; người tạo approve → SELF_APPROVAL_FORBIDDEN; người khác đúng scope approve rồi post thành công | #51 |
| INV-009 | Cancel CONFIRMED chưa thu tiền/giao → ACTIVE reservation RELEASED cùng giảm reserved; cancel đua ship chỉ một transition commit | #64 |
| SAL-001 | Không có dòng hoặc SKU inactive/khác tổ chức → không tạo đơn | #61 |
| SAL-002 | quantity≤0, >3 decimal hoặc client gửi unitPrice →400; giá không âm từ database | #61 |
| SAL-003 | Đổi tên/giá catalog sau tạo đơn → snapshot lịch sử không đổi; edit DRAFT snapshot lại theo chính sách | #61 |
| SAL-004 | Giảm tiền >subtotal hoặc percent>100 → từ chối; HALF_UP từng dòng đúng ở giá trị .5 | #61 |
| SAL-005 | Đơn FULFILLED hoặc đã nhận payment bị cancel →409, không đảo movement/payment | #64 |
| SAL-006 | PATCH CONFIRMED hoặc gửi status → từ chối, giá/sản phẩm bất biến | #60, #61 |
| SAL-007 | Key cũ cùng payload → response replay; khác payload →409; key mới confirm đơn đã CONFIRMED không giữ lần hai | #47, #62 |
| SAL-008 | Shipment thiếu/thừa dòng/quantity → từ chối toàn bộ; đủ một lần mới post | #63 |
| SAL-010 | Hai create order đồng thời → số SO khác nhau, unique organization/order_number, sequence transactional | #59, #61 |
| FIN-001 | Giá/tổng lớn và số lẻ → Decimal chính xác, không IEEE754 trong tính tiền | #61, #65 |
| FIN-002 | Payment chỉ CONFIRMED/FULFILLED, CASH có lý do, BANK_TRANSFER có externalReference; hai payment đua không thu vượt tổng | #65 |
| FIN-003 | Reference khác hoa/thường/whitespace theo normalization → unique chặn duplicate; key replay không thu hai lần | #65 |

INV-006 chuyển kho, SAL-009 hoàn tiền, PUR-001–004, FIN-004–005 thuộc Phase 5: kịch bản là phê duyệt/nhận hàng đúng ngưỡng, transfer xuất-nhập đúng trạng thái, refund không vượt đã thu, chứng từ posted không sửa và đối soát phân bổ. Chưa được coi là đạt hoặc xuất API ở MVP. Rate-limit/CSRF/cookie và các misuse case xem #35/#45; outbox gửi lại phải consumer-idempotent, retry bounded và chỉ đọc sự kiện commit (#67).
