# -*- coding: utf-8 -*-
"""Buoc 3: xuat bang doi chieu TEN DIEM DO giua Excel va PocketBase.

Day la CHOT CHAN cua ca dot dong bo: moi giao dich trong Excel tro toi mot ten
diem do, ghep sai la gan vat tu vao SAI MAY BIEN AP => sai ton that, sai hoa don.
Nen script nay CHI XUAT BANG cho nguoi duyet, KHONG tu ghep.

Chia lam 4 nhom:
  KHOP     - ten trung khit, ghep duoc ngay
  KHO      - diem do ao cua Excel (DU PHONG / THU HOI / TRA / GETC) -> se thanh kho
  GAN GIONG- can NGUOI xac nhan tung cap
  MOI      - chi co o Excel, khong giong ai => diem do that su moi

    python scripts/excel_step3_match_points.py --out ../..\/plans/doi-chieu-diem-do.md
"""
import argparse
import difflib
import re
import sys

import openpyxl
import pb_client as pb

XLSX = (r"C:/Users/thang.nguyen-manh/OneDrive - GELEX/"
        r"Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/"
        r"9. Quản lý kho/Quản lý kho V2.xlsx")

KHO_PAT = re.compile(r"DỰ PHÒNG|THU HỒI|TRẢ|THANH LÝ|GETC", re.U)


def norm(s):
    """Bo dau cach / dau cham / hoa-thuong de so sanh."""
    return re.sub(r"[^A-Z0-9]", "", s.upper())


def read_excel_points():
    wb = openpyxl.load_workbook(XLSX, data_only=True, read_only=True)
    ws = wb["Quản lý điểm đo"]
    it = ws.iter_rows(values_only=True)
    next(it)
    out = []
    for r in it:
        if not r or not r[0]:
            continue
        out.append({
            "ten": str(r[0]).strip(),
            "mkh": str(r[1]).strip() if r[1] else "",
            "trang_thai": str(r[2]).strip() if r[2] else "",
            "dong_dien": r[3],
            "thanh_ly": r[4],
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="File Markdown de ghi bang doi chieu")
    ap.add_argument("--cutoff", type=float, default=0.80)
    args = ap.parse_args()

    token = pb.login()
    pts = pb.list_records(token, "dm_point")
    zones = {z["id"]: z["code"] for z in pb.list_records(token, "dm_zone")}
    pb_by_norm = {}
    for p in pts:
        pb_by_norm.setdefault(norm(p.get("line_name") or ""), p)

    xl = read_excel_points()
    khop, kho, gan, moi = [], [], [], []

    for x in xl:
        n = norm(x["ten"])
        if KHO_PAT.search(x["ten"].upper()):
            kho.append(x)
            continue
        if n in pb_by_norm:
            khop.append((x, pb_by_norm[n]))
            continue
        m = difflib.get_close_matches(n, list(pb_by_norm.keys()), n=3, cutoff=args.cutoff)
        if m:
            gan.append((x, [pb_by_norm[k] for k in m]))
        else:
            moi.append(x)

    used = {p["id"] for _, p in khop}
    chi_pb = [p for p in pts if p["id"] not in used]

    L = []
    L.append("# Đối chiếu tên điểm đo: Excel ⟷ PocketBase\n")
    L.append("- **Ngày**: 2026-08-05")
    L.append("- **Nguồn**: `Quản lý kho V2.xlsx` · sheet *Quản lý điểm đo*")
    L.append("- Sinh bởi `scripts/excel_step3_match_points.py` — **script KHÔNG tự ghép**\n")
    L.append("> Ghép sai = gắn vật tư vào **sai máy biến áp** ⇒ sai tổn thất, sai hóa đơn.")
    L.append("> Vì vậy mục §3 phải do người hiểu hiện trường duyệt từng cặp.\n")
    L.append("| Nhóm | Số lượng | Việc cần làm |")
    L.append("|---|---|---|")
    L.append("| 1. Khớp khít | %d | ghép tự động, chỉ ghi `ops_name` |" % len(khop))
    L.append("| 2. Kho ảo | %d | chuyển thành kho, không phải điểm đo |" % len(kho))
    L.append("| 3. Gần giống | %d | **CẦN DUYỆT TỪNG CẶP** |" % len(gan))
    L.append("| 4. Chỉ có ở Excel | %d | tạo mới, hoặc là điểm đo đã bỏ |" % len(moi))
    L.append("| 5. Chỉ có ở PocketBase | %d | Excel chưa có — kiểm tra lại |" % len(chi_pb))

    L.append("\n---\n\n## 1. Khớp khít (%d)\n" % len(khop))
    L.append("| Excel | PocketBase | MKH | Trạng thái |")
    L.append("|---|---|---|---|")
    for x, p in khop:
        L.append("| `%s` | `%s` | %s | %s |" % (x["ten"], p.get("line_name"), x["mkh"], x["trang_thai"]))

    L.append("\n## 2. Kho ảo của Excel (%d)\n" % len(kho))
    L.append("| Tên | Trạng thái | Đề xuất |")
    L.append("|---|---|---|")
    for x in kho:
        L.append("| `%s` | %s | → kho |" % (x["ten"], x["trang_thai"]))

    L.append("\n## 3. GẦN GIỐNG — CẦN BẠN DUYỆT (%d)\n" % len(gan))
    L.append("Đánh dấu cột **Chọn**: ghi `1`/`2`/`3` nếu đúng là cùng một điểm đo,")
    L.append("ghi `MOI` nếu đây thực sự là điểm đo khác.\n")
    L.append("| # | Excel | Ứng viên 1 | Ứng viên 2 | Ứng viên 3 | Chọn |")
    L.append("|---|---|---|---|---|---|")
    for i, (x, cands) in enumerate(gan, 1):
        c = [p.get("line_name", "") for p in cands] + ["", "", ""]
        L.append("| %d | `%s` | `%s` | `%s` | `%s` |  |" % (i, x["ten"], c[0], c[1], c[2]))

    L.append("\n## 4. Chỉ có ở Excel (%d)\n" % len(moi))
    L.append("| Tên | MKH | Trạng thái | Ngày đóng điện |")
    L.append("|---|---|---|---|")
    for x in moi:
        dd = str(x["dong_dien"])[:10] if x["dong_dien"] else ""
        L.append("| `%s` | %s | %s | %s |" % (x["ten"], x["mkh"], x["trang_thai"], dd))

    L.append("\n## 5. Chỉ có ở PocketBase (%d)\n" % len(chi_pb))
    L.append("| Tên | KCN | Trạng thái |")
    L.append("|---|---|---|")
    for p in chi_pb:
        L.append("| `%s` | %s | %s |" % (p.get("line_name"), zones.get(p.get("zone"), "?"),
                                         p.get("point_status", "")))

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")

    print("Khop khit      : %d" % len(khop))
    print("Kho ao         : %d" % len(kho))
    print("GAN GIONG      : %d   <-- can duyet" % len(gan))
    print("Chi co o Excel : %d" % len(moi))
    print("Chi co o PB    : %d" % len(chi_pb))
    print("\nDa ghi %s" % args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
