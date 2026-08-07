"""Tạo 4 collection `v2_*` trên PocketBase PRODUCTION cho module vật tư làm lại.

Chạy:
    PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... python scripts/v2_create_collections.py
Thêm --dry-run để chỉ xem sẽ tạo gì, không ghi.

RÀNG BUỘC AN TOÀN (user chốt 07/08): script CHỈ được tạo mới collection có tiền
tố `v2_`. Không xóa, không sửa, không đụng tới `dm_*` / `vt_*` / `users` của app
cũ. Ràng buộc này được kiểm tra bằng code ở `guard()` chứ không chỉ nằm trong
lời hứa — nhầm một dòng ở đây là hỏng dữ liệu thật.

Collection nào đã tồn tại thì BỎ QUA (in ra), không ghi đè — chạy lại nhiều lần
vô hại.
"""
import os
import sys
import json
import urllib.request
import urllib.error

PB_URL = os.environ.get("V2_PB_URL", "https://getc.up.railway.app/pb").rstrip("/")
PREFIX = "v2_"
DRY = "--dry-run" in sys.argv


def guard(name: str) -> None:
    """Chặn cứng: chỉ đụng vào collection mang tiền tố v2_."""
    if not name.startswith(PREFIX):
        raise SystemExit(f"TỪ CHỐI: '{name}' không mang tiền tố '{PREFIX}' — script này không được phép đụng vào bảng cũ.")


def api(method: str, path: str, token: str = "", body: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"{PB_URL}{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": token} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} → HTTP {e.code}: {e.read().decode(errors='replace')[:400]}")


def txt(name, **kw):
    return {"name": name, "type": "text", **kw}


def num(name, **kw):
    return {"name": name, "type": "number", **kw}


def sel(name, values, **kw):
    return {"name": name, "type": "select", "maxSelect": 1, "values": values, **kw}


ASSET_TYPES = ["ME41", "ME42", "DTS27", "TI", "TU", "GP03", "KHAC"]
POINT_STATUS = ["du_kien", "chua_van_hanh", "active", "dismounted"]
ASSET_STATUS = ["kho", "dang_treo", "cho_kiem_dinh", "dang_kiem_dinh", "dat", "khong_dat", "thanh_ly"]
EVENTS = ["nhap_kho", "dieu_chuyen", "treo", "thao", "gui_kiem_dinh", "ket_qua_kiem_dinh", "thanh_ly"]

# Quyền: đọc = đã đăng nhập; ghi = superuser (rule None). Siết trước, nới sau —
# nới quyền dễ, thu hồi dữ liệu bị ghi bậy thì không.
RULES_READONLY = {
    "listRule": '@request.auth.id != ""',
    "viewRule": '@request.auth.id != ""',
    "createRule": None, "updateRule": None, "deleteRule": None,
}

SCHEMA: list[dict] = [
    {
        "name": "v2_point", "type": "base", **RULES_READONLY,
        "fields": [
            txt("code", required=True), txt("name"),
            txt("zone_code"), txt("station_code"),
            sel("point_status", POINT_STATUS),
            txt("note"),
        ],
        "indexes": ["CREATE UNIQUE INDEX idx_v2_point_code ON v2_point (code)"],
    },
    {
        "name": "v2_asset", "type": "base", **RULES_READONLY,
        "fields": [
            txt("serial", required=True), sel("type", ASSET_TYPES),
            txt("model_desc"), txt("manufacturer"),
            num("ratio_primary"), num("ratio_secondary"), num("ratio"),
            {"name": "calibration_date", "type": "date"},
            {"name": "next_calibration", "type": "date"},
            sel("current_status", ASSET_STATUS),
            txt("current_point"), txt("note"),
        ],
        "indexes": ["CREATE UNIQUE INDEX idx_v2_asset_serial ON v2_asset (serial)"],
    },
    {
        "name": "v2_install", "type": "base", **RULES_READONLY,
        "fields": [
            txt("asset", required=True), txt("point", required=True),
            {"name": "from_date", "type": "date"}, {"name": "to_date", "type": "date"},
            {"name": "is_current", "type": "bool"},
        ],
        "indexes": ["CREATE INDEX idx_v2_install_point ON v2_install (point, is_current)"],
    },
    {
        # Sổ cái: cố ý KHÔNG có deleteRule — sự kiện là bằng chứng, không xóa.
        "name": "v2_event", "type": "base", **RULES_READONLY,
        "fields": [
            txt("asset", required=True), txt("serial"),
            sel("event", EVENTS), txt("from_point"), txt("to_point"),
            {"name": "at", "type": "date"}, txt("by"),
            txt("document_no"), sel("result", ["dat", "khong_dat"]), txt("note"),
        ],
        "indexes": ["CREATE INDEX idx_v2_event_asset ON v2_event (asset)"],
    },
]


def main() -> None:
    for c in SCHEMA:
        guard(c["name"])

    email = os.environ.get("PB_ADMIN_EMAIL")
    password = os.environ.get("PB_ADMIN_PASSWORD")
    if not (email and password):
        raise SystemExit("Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD")

    auth = api("POST", "/api/collections/_superusers/auth-with-password", body={
        "identity": email, "password": password})
    token = auth["token"]
    print(f"Đã đăng nhập superuser tại {PB_URL}")

    existing = {c["name"] for c in api("GET", "/api/collections?perPage=200", token).get("items", [])}
    print(f"Hiện có {len(existing)} collection; sẽ KHÔNG đụng tới bất kỳ cái nào trong số đó.")

    for c in SCHEMA:
        name = c["name"]
        guard(name)
        if name in existing:
            print(f"  bỏ qua {name} (đã tồn tại)")
            continue
        if DRY:
            print(f"  [dry-run] sẽ tạo {name} với {len(c['fields'])} trường")
            continue
        api("POST", "/api/collections", token, c)
        print(f"  đã tạo {name}")

    print("Xong.")


if __name__ == "__main__":
    main()
