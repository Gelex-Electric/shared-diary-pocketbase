# -*- coding: utf-8 -*-
"""Mo quyen SUA cho vt_event (user chot 05/08), van GIU khoa XOA.

Vi sao phai doi: so cai duoc thiet ke bat bien - `updateRule=None` nghia la chi
superuser sua duoc. Nhung nhap sai ngay la chuyen xay ra that, khong sua duoc
thi nguoi dung se ghi mot su kien "bu" cho du, con te hon vi so cai co hai dong
mau thuan.

Danh doi: lich su co the bi viet lai. Giam thieu:
  - `deleteRule` VAN None: khong ai xoa duoc su kien.
  - Moi lan sua ngay, app ghi them mot dong vet vao `note` (xem lifecycle.ts).
  - Quyen sua = R_WRITE (khoi kinh doanh), khong mo cho tai khoan pham vi KCN.

    python scripts/allow_event_date_edit.py --dry-run
    python scripts/allow_event_date_edit.py --apply
"""
import argparse
import json
import sys

import pb_client as pb

R_WRITE = '@request.auth.id != "" && @request.auth.area = ""'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    token = pb.login()
    cols = pb.list_collections(token)
    ev = next((c for c in cols if c["name"] == "vt_event"), None)
    if not ev:
        print("Khong tim thay collection vt_event")
        return 1

    print("Hien tai:")
    for k in ("listRule", "viewRule", "createRule", "updateRule", "deleteRule"):
        print("   %-12s = %r" % (k, ev.get(k)))

    if ev.get("updateRule") == R_WRITE:
        print("\nDa mo quyen sua tu truoc - khong can lam gi.")
        return 0

    print("\nSe doi: updateRule = %r  (deleteRule GIU NGUYEN None)" % R_WRITE)
    if not args.apply:
        print("CHAY THU - chua ghi gi. Them --apply de ghi that.")
        return 0

    r = pb.req("patch",
               "%s/api/collections/%s" % (pb.PB_URL, ev["id"]),
               headers={**pb.headers(token), "Content-Type": "application/json"},
               data=json.dumps({"updateRule": R_WRITE}))
    r.raise_for_status()

    # Doc lai de xac nhan, khong tin vao ma tra ve
    ev2 = next(c for c in pb.list_collections(token) if c["name"] == "vt_event")
    print("\nSau khi ghi:")
    for k in ("updateRule", "deleteRule"):
        print("   %-12s = %r" % (k, ev2.get(k)))
    ok = ev2.get("updateRule") == R_WRITE and ev2.get("deleteRule") is None
    print("\n%s" % ("OK" if ok else "KHONG DUNG NHU MONG DOI"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
