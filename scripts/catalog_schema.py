"""Dinh nghia schema 9 collection moi (plan 2026-08-03-mo-hinh-danh-muc-va-kho-vat-tu.md).

Nguyen tac:
- KHONG dung den bat ky collection cu nao (user chot 03/08). Moi ten deu co
  tien to dm_ (danh muc) hoac vt_ (vat tu) nen khong the trung.
- Thu tu trong SCHEMA la thu tu PHU THUOC relation: bang duoc tham chieu phai
  tao truoc. Doi thu tu se lam relation tro vao collectionId rong.
- Quyen: doc = da dang nhap; ghi = khoi kinh doanh (users.area rong).
  vt_event la so cai -> update/delete = None (chi superuser).
"""

# Doc: bat ky ai da dang nhap (ke ca van hanh) deu xem duoc
R_READ = '@request.auth.id != ""'
# Ghi: chi khoi kinh doanh. Phan khoi theo users.area (nguyen tac 14 ARCHITECTURE.md):
#   co area = Van hanh, area rong = Kinh doanh
R_WRITE = '@request.auth.id != "" && @request.auth.area = ""'

# 5 KCN - PHAI khop users.area2 thi filter phan quyen moi join duoc
ZONE_CODES = ["KCNTH", "KCNPĐ", "KCNTTI", "KCNYM", "KCN03"]

# Loai o muc MODEL (user chot 03/08): cong to tach ME41/ME42/DTS27
ASSET_TYPES = ["ME41", "ME42", "DTS27", "TI", "TU", "SIM", "GP03", "KHAC"]
ASSET_STATUS = ["kho", "dang_treo", "cho_kiem_dinh", "dang_kiem_dinh", "dat", "khong_dat", "thanh_ly"]
EVENT_TYPES = ["nhap_kho", "dieu_chuyen", "treo", "thao", "gui_kiem_dinh", "ket_qua_kiem_dinh", "thanh_ly"]
# Bo "sub_meter": vai tro chinh/phu da nam o truong `role` (user chot 03/08)
POINT_STATUS = ["du_kien", "chua_van_hanh", "active", "dismounted"]


def txt(name, required=False, presentable=False):
    return {"name": name, "type": "text", "required": required, "presentable": presentable}


def num(name, required=False):
    return {"name": name, "type": "number", "required": required}


def boolean(name):
    return {"name": name, "type": "bool", "required": False}


def date(name, required=False):
    return {"name": name, "type": "date", "required": required}


def sel(name, values, required=False):
    return {"name": name, "type": "select", "required": required, "maxSelect": 1, "values": values}


def rel(name, target, required=False):
    """target = ten collection; se duoc doi sang collectionId luc tao."""
    return {
        "name": name, "type": "relation", "required": required,
        "maxSelect": 1, "cascadeDelete": False, "_target": target,
    }


def stamps():
    return [
        {"name": "created", "type": "autodate", "onCreate": True, "onUpdate": False},
        {"name": "updated", "type": "autodate", "onCreate": True, "onUpdate": True},
    ]


def uniq(coll, *cols):
    cname = "_".join(cols)
    return f"CREATE UNIQUE INDEX `idx_uniq_{coll}_{cname}` ON `{coll}` ({', '.join('`%s`' % c for c in cols)})"


def idx(coll, *cols):
    cname = "_".join(cols)
    return f"CREATE INDEX `idx_{coll}_{cname}` ON `{coll}` ({', '.join('`%s`' % c for c in cols)})"


SCHEMA = [
    # ---------- LUONG 1: danh muc phan cap ----------
    {
        "name": "dm_zone",
        "fields": [
            txt("code", required=True, presentable=True),
            txt("name", required=True),
            txt("area_label"),          # khop users.area (ten day du co dau)
            *stamps(),
        ],
        "indexes": [uniq("dm_zone", "code")],
    },
    {
        "name": "dm_station",
        "fields": [
            txt("code", required=True, presentable=True),
            txt("name"),
            rel("zone", "dm_zone"),
            num("sdm_kva"), num("p0_kw"), num("pk_kw"),
            txt("note"),
            *stamps(),
        ],
        "indexes": [uniq("dm_station", "code"), idx("dm_station", "zone")],
    },
    {
        "name": "dm_customer",
        "fields": [
            txt("mkh", required=True, presentable=True),
            txt("name", required=True),
            txt("tax_code"), txt("address"),
            rel("zone", "dm_zone"),
            boolean("active"),
            *stamps(),
        ],
        "indexes": [uniq("dm_customer", "mkh"), idx("dm_customer", "zone")],
    },
    {
        "name": "dm_point",
        "fields": [
            txt("line_id", required=True, presentable=True),
            txt("line_name"),
            rel("station", "dm_station"),
            rel("zone", "dm_zone"),
            sel("role", ["chinh", "phu"]),
            sel("voltage_level", ["LV", "MV"]),
            sel("point_status", POINT_STATUS),
            num("hsn_invoice"),          # HSN doc tu hoa don - de doi chung
            num("hsn_calc"),             # HSN suy tu vt_install (TI x TU)
            boolean("hsn_mismatch"),
            txt("note"),
            *stamps(),
        ],
        "indexes": [
            uniq("dm_point", "line_id"),
            idx("dm_point", "station"),
            idx("dm_point", "zone"),
        ],
    },
    {
        # KY khach hang <-> diem do. Khong gan khach vao tram vi 1 tram co nhieu
        # diem do thuoc cac khach KHAC NHAU (3 ca that: TH.BQL.T2, TTI.BQL.T3, 03.TMD).
        "name": "dm_point_customer",
        "fields": [
            rel("point", "dm_point", required=True),
            rel("customer", "dm_customer", required=True),
            txt("mkh"),
            date("from_date"), date("to_date"),   # to_date rong = ky hien tai
            boolean("is_current"),
            boolean("shared"),                    # nhieu khach cung diem do, ky giao nhau
            txt("note"),
            *stamps(),
        ],
        "indexes": [
            idx("dm_point_customer", "point"),
            idx("dm_point_customer", "customer"),
            idx("dm_point_customer", "is_current"),
        ],
    },
    # ---------- LUONG 2: vat tu & kho ----------
    {
        "name": "vt_warehouse",
        "fields": [
            txt("code", required=True, presentable=True),
            txt("name", required=True),
            rel("zone", "dm_zone"),
            boolean("active"),
            txt("note"),
            *stamps(),
        ],
        "indexes": [uniq("vt_warehouse", "code")],
    },
    {
        "name": "vt_asset",
        "fields": [
            txt("serial", required=True, presentable=True),
            sel("type", ASSET_TYPES, required=True),
            txt("model_desc"), txt("manufacturer"), txt("accuracy_class"),
            num("ratio_primary"), num("ratio_secondary"), num("ratio"),
            num("manufacture_year"),     # goc tinh han kiem dinh
            date("calibration_date"), date("next_calibration"),
            sel("current_status", ASSET_STATUS),
            rel("current_warehouse", "vt_warehouse"),
            rel("current_point", "dm_point"),
            boolean("hes_seen"),         # rong KHONG phai loi: vat tu mua truoc, chua treo
            txt("note"),
            *stamps(),
        ],
        "indexes": [
            uniq("vt_asset", "serial"),
            idx("vt_asset", "type"),
            idx("vt_asset", "current_status"),
        ],
    },
    {
        # LICH SU LAP DAT - bang thu 4 user yeu cau
        "name": "vt_install",
        "fields": [
            rel("asset", "vt_asset", required=True),
            txt("serial"),
            sel("type", ASSET_TYPES),
            rel("point", "dm_point", required=True),
            sel("phase", ["A", "B", "C"]),
            date("from_date", required=True), date("to_date"),
            boolean("is_current"),
            txt("install_doc"), txt("remove_doc"),
            txt("note"),
            *stamps(),
        ],
        "indexes": [
            idx("vt_install", "asset"),
            idx("vt_install", "point"),
            idx("vt_install", "is_current"),
        ],
    },
    {
        # SO CAI vong doi - append only
        "name": "vt_event",
        "fields": [
            rel("asset", "vt_asset", required=True),
            txt("serial"),
            sel("event", EVENT_TYPES, required=True),
            rel("from_warehouse", "vt_warehouse"),
            rel("to_warehouse", "vt_warehouse"),
            rel("from_point", "dm_point"),
            rel("to_point", "dm_point"),
            txt("from_label"), txt("to_label"),    # mo ta tu do (vd don vi kiem dinh)
            {"name": "at", "type": "date", "required": True},
            rel("by", "users"),
            txt("document_no"),
            sel("result", ["dat", "khong_dat"]),   # chi voi ket_qua_kiem_dinh
            txt("note"),
            *stamps(),
        ],
        "indexes": [
            idx("vt_event", "asset"),
            idx("vt_event", "event"),
            idx("vt_event", "at"),
        ],
        # So cai phai bat bien: sua/xoa = chi superuser
        "rules": {
            "listRule": R_READ, "viewRule": R_READ,
            "createRule": R_WRITE, "updateRule": None, "deleteRule": None,
        },
    },
]


def rules_for(entry: dict) -> dict:
    if "rules" in entry:
        return entry["rules"]
    return {
        "listRule": R_READ, "viewRule": R_READ,
        "createRule": R_WRITE, "updateRule": R_WRITE, "deleteRule": R_WRITE,
    }
