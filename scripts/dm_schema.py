#!/usr/bin/env python3
"""
Tạo 4 collection danh mục trên PocketBase: dm_zone, dm_station, dm_customer, dm_point.

NGUYÊN TẮC BẤT DI BẤT DỊCH (user chốt 14/08/2026):
    Script này CHỈ TẠO collection mới. Không PATCH, không DELETE bất kỳ
    collection nào đang có. Collection nào đã tồn tại thì BỎ QUA, kể cả khi
    schema khác mong đợi — khi đó script báo ra để người dùng tự quyết.

Chạy:
    PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... python scripts/dm_schema.py
    thêm --dry-run để chỉ xem sẽ tạo gì.

Quan hệ: dm_zone 1-N dm_station 1-N dm_point;  dm_customer 1-N dm_point.
Vật tư (dm_asset) KHÔNG nằm trong bước này.
"""
import json
import os
import sys
import urllib.error
import urllib.request

PB_URL = os.environ.get('PB_URL', 'https://getc.up.railway.app/pb').rstrip('/')
EMAIL = os.environ.get('PB_ADMIN_EMAIL', '')
PASSWORD = os.environ.get('PB_ADMIN_PASSWORD', '')
DRY_RUN = '--dry-run' in sys.argv

# Các collection đang chạy — script phải để nguyên, dùng để kiểm chứng trước/sau.
PROTECTED = {
    'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
    'PowerOutage', 'AccountHes', 'New_update', 'users',
}


def call(method, path, token=None, body=None):
    req = urllib.request.Request(
        f'{PB_URL}{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type': 'application/json',
                 **({'Authorization': token} if token else {})},
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        raise SystemExit(f'HTTP {e.code} {method} {path}\n{e.read().decode()}')


def auth():
    r = call('POST', '/api/collections/_superusers/auth-with-password',
             body={'identity': EMAIL, 'password': PASSWORD})
    return r['token']


def list_collections(token):
    r = call('GET', '/api/collections?perPage=500', token)
    return {c['name']: c for c in r['items']}


# ---------- helper dựng field ----------
def text(name, required=False):
    return {'name': name, 'type': 'text', 'required': required}


def num(name):
    return {'name': name, 'type': 'number', 'required': False}


def boolean(name):
    return {'name': name, 'type': 'bool', 'required': False}


def select(name, values, required=False):
    return {'name': name, 'type': 'select', 'required': required,
            'maxSelect': 1, 'values': values}


def rel(name, collection_id, required=False):
    """Quan hệ 1 chiều, maxSelect=1. cascadeDelete=False: xóa cha KHÔNG xóa con,
    tránh mất dữ liệu dây chuyền — con mồ côi sẽ hiện cảnh báo trên UI."""
    return {'name': name, 'type': 'relation', 'required': required,
            'maxSelect': 1, 'minSelect': 0, 'collectionId': collection_id,
            'cascadeDelete': False}


AUTODATE = [
    {'name': 'created', 'type': 'autodate', 'onCreate': True, 'onUpdate': False},
    {'name': 'updated', 'type': 'autodate', 'onCreate': True, 'onUpdate': True},
]

AUTH_RULE = "@request.auth.id != ''"


def base_collection(name, fields, indexes=()):
    return {
        'name': name, 'type': 'base',
        'fields': list(fields) + AUTODATE,
        'indexes': list(indexes),
        'listRule': AUTH_RULE, 'viewRule': AUTH_RULE,
        'createRule': AUTH_RULE, 'updateRule': AUTH_RULE, 'deleteRule': AUTH_RULE,
    }


def uniq(coll, field):
    return f'CREATE UNIQUE INDEX `idx_uniq_{coll}_{field}` ON `{coll}` (`{field}`)'


def idx(coll, field):
    return f'CREATE INDEX `idx_{coll}_{field}` ON `{coll}` (`{field}`)'


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD')

    token = auth()
    before = list_collections(token)
    print(f'PB: {PB_URL}')
    print(f'Trước khi chạy: {len(before)} collection — '
          f'{", ".join(sorted(n for n in before if not n.startswith("_")))}\n')

    created = []

    def ensure(spec):
        name = spec['name']
        if name in before:
            print(f'  = {name}: ĐÃ CÓ, bỏ qua (không sửa)')
            return before[name]['id']
        if DRY_RUN:
            print(f'  + {name}: sẽ tạo ({len(spec["fields"])} field)')
            return f'<{name}>'
        r = call('POST', '/api/collections', token, spec)
        created.append(name)
        print(f'  + {name}: đã tạo (id {r["id"]})')
        return r['id']

    # --- 1. KCN ---
    zone_id = ensure(base_collection('dm_zone', [
        text('code', required=True),
        text('name', required=True),
        text('address'),
        boolean('active'),
    ], [uniq('dm_zone', 'code')]))

    # --- 2. Trạm: thuộc 1 KCN ---
    station_id = ensure(base_collection('dm_station', [
        text('code', required=True),
        text('name'),
        rel('zone', zone_id, required=True),
        num('sdm_kva'),
        num('p0_kw'),
        num('pk_kw'),
        text('note'),
    ], [uniq('dm_station', 'code'), idx('dm_station', 'zone')]))

    # --- 3. Khách hàng ---
    customer_id = ensure(base_collection('dm_customer', [
        text('mkh', required=True),
        text('name', required=True),
        text('address'),
        rel('zone', zone_id),
        boolean('active'),
    ], [uniq('dm_customer', 'mkh'), idx('dm_customer', 'zone')]))

    # --- 4. Điểm đo: thuộc 1 trạm, gắn 1 khách hàng ---
    ensure(base_collection('dm_point', [
        text('line_id', required=True),
        text('line_name', required=True),
        rel('station', station_id, required=True),
        rel('zone', zone_id),          # dẫn xuất từ trạm, lưu sẵn để lọc nhanh
        rel('customer', customer_id),
        select('role', ['chinh', 'phu'], required=True),
        select('connection', ['truc_tiep', 'gian_tiep'], required=True),
        num('hsn'),                    # trực tiếp = 1; gián tiếp tính từ TI/TU
        select('voltage_level', ['LV', 'MV']),
        select('status', ['du_kien', 'chua_van_hanh', 'active', 'thao_go']),
        text('note'),
    ], [uniq('dm_point', 'line_id'), idx('dm_point', 'station'),
        idx('dm_point', 'zone'), idx('dm_point', 'customer')]))

    # --- Kiểm chứng: 9 collection cũ phải nguyên vẹn ---
    if DRY_RUN:
        print('\n[DRY-RUN] Không ghi gì.')
        return

    after = list_collections(token)
    print('\nĐối chiếu collection có sẵn (phải KHÔNG đổi):')
    bad = False
    for name in sorted(PROTECTED):
        b, a = before.get(name), after.get(name)
        if a is None:
            print(f'  ✗ {name}: BIẾN MẤT'); bad = True
        elif json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
            print(f'  ✗ {name}: BỊ THAY ĐỔI'); bad = True
        else:
            print(f'  ✓ {name}: nguyên vẹn')
    print(f'\nĐã tạo mới: {created or "(không có)"}')
    print(f'Tổng collection: {len(before)} → {len(after)}')
    if bad:
        raise SystemExit('LỖI: có collection cũ bị đụng vào.')


if __name__ == '__main__':
    main()
