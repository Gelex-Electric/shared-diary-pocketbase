# Hướng dẫn vẽ Sơ đồ một sợi bằng draw.io (cho người không code)

Admin chỉ cần **vẽ** và **lưu file** đúng quy ước. App sẽ tự đọc và hiển thị,
người dùng cuối chỉ xem + bấm đóng/cắt.

---

## 1. Mở công cụ vẽ
Vào **https://app.diagrams.net** (draw.io) — chọn lưu vào máy (Device).

## 2. Vẽ các thiết bị
Kéo các hình vào canvas. **Cách gõ nhãn quyết định loại thiết bị** — gõ tên theo
đúng tiền tố dưới đây (không phân biệt hoa/thường):

| Thiết bị        | Gõ nhãn bắt đầu bằng        | Ví dụ            |
|-----------------|----------------------------|------------------|
| Nguồn / xuất tuyến | `Nguồn`                 | `Nguồn 22kV`     |
| Thanh cái       | `TC` hoặc `Thanh cái`      | `TC C41`         |
| Máy cắt         | `MC`                       | `MC 471`         |
| Dao cách ly     | `DCL`                      | `DCL 471-7`      |
| Máy biến áp     | `MBA` hoặc `T1, T2...`     | `MBA T1`         |
| Phụ tải         | `Tải` hoặc `Phụ tải`       | `Tải A`          |

> Mẹo: bố trí từ **trên xuống dưới** theo dòng điện (nguồn ở trên, tải ở dưới).
> Toạ độ admin đặt ở draw.io sẽ giữ nguyên khi hiển thị trên app.

## 3. Nối dây
Rê chuột từ mép hình này sang hình kia để tạo đường nối. **Phải nối chạm đúng
vào hình** (2 đầu dính vào thiết bị) thì app mới hiểu là có liên kết điện.

## 4. (Tuỳ chọn) Đặt trạng thái cắt sẵn
Mặc định mọi máy cắt/dao là **đóng**. Muốn một thiết bị hiển thị **cắt** sẵn:
chọn hình → menu **Edit → Edit Style…** → thêm vào cuối: `state=open;`

> Nâng cao: thay vì dựa vào nhãn, có thể ép loại bằng cách thêm
> `sldType=breaker;` (hoặc `source/busbar/disconnector/transformer/load`) vào Edit Style.

## 5. Lưu file ĐÚNG ĐỊNH DẠNG (quan trọng)
App đọc XML **không nén**. Làm 1 lần:
- Menu **Extras → Theme/… → bỏ chọn "Compressed"** (hoặc khi Save chọn dạng XML).
- Sau đó **File → Save / Export as → XML…**, bỏ tick "Compressed" nếu được hỏi.

Kết quả là file `.xml` (hoặc `.drawio`) ở dạng văn bản đọc được. Nếu mở file
bằng Notepad thấy chữ `<mxGraphModel>` là đúng; nếu thấy chuỗi ký tự lộn xộn
là đang bị nén → lưu lại.

## 6. Đưa bản vẽ vào app rồi deploy
1. Chép file XML vào thư mục `src/components/sld/diagrams/`, đặt tên rõ ràng,
   vd `tba-475.drawio.xml`.
2. Mở `src/components/sld/diagrams/index.ts`, thêm 2 dòng theo mẫu có sẵn:
   ```ts
   import tba475Xml from './tba-475.drawio.xml?raw';
   const tba475b = parseDrawio(tba475Xml, { id: 'tba-475', title: 'TBA 475' });
   // rồi thêm  [tba475b.id]: tba475b  vào DIAGRAMS
   ```
3. (Tuỳ chọn) Gán user → sơ đồ trong `USER_DIAGRAM`.
4. `git push` → Railway tự build & deploy. Xong, không cần chạy local.

---

### Lỗi thường gặp
- **Không thấy thiết bị nào**: nhãn gõ sai tiền tố, hoặc file đang bị nén.
- **Thiếu dây nối**: đường vẽ chưa dính hẳn vào hình (đầu dây bị lơ lửng).
- **Sai loại thiết bị**: đổi lại nhãn cho đúng bảng ở mục 2, hoặc dùng `sldType=`.
