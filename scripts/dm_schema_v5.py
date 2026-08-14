#!/usr/bin/env python3
"""
Schema đợt 5 — bảng VẬT TƯ (user yêu cầu 14/08/2026).

  dm_asset : serial (unique), type, point, phase, ratio_primary,
             ratio_secondary, model_desc, status, note

Mỗi vật tư là một bản ghi trỏ về điểm đo đang lắp. Nhờ vậy sau này làm được
kho / kiểm định / thay thế, và tra được một số No đang nằm ở điểm đo nào.

HSN suy ra từ tỷ số: HSN = (TI sơ cấp / TI thứ cấp) × (TU sơ cấp / TU thứ cấp),
TU bỏ trống thì coi bằng 1. Điểm đo đấu trực tiếp không có TI → HSN = 1.

NGUYÊN TẮC GIỮ NGUYÊN: chỉ TẠO collection mới. KHÔNG chạm 9 collection có sẵn.
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


def collections(token):
    return {c['name']: c for c in call('GET', '/api/collections?perPage=500', token)['items']}


AUTH_RULE = "@request.auth.id != ''"


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD')

    token = call('POST', '/api/collections/_superusers/auth-with-password',
                 body={'identity': EMAIL, 'password': PASSWORD})['token']
    before = collections(token)

    if 'dm_asset' in before:
        print('= dm_asset: đã có, không làm gì.')
        return
    point = before.get('dm_point')
    if not point:
        raise SystemExit('Chưa có dm_point — chạy scripts/dm_schema.py trước.')

    spec = {
        'name': 'dm_asset', 'type': 'base',
        'fields': [
            {'name': 'serial', 'type': 'text', 'required': True},
            {'name': 'type', 'type': 'select', 'required': True, 'maxSelect': 1,
             'values': ['CONGTO', 'GP03', 'TI', 'TU', 'SIM', 'KHAC']},
            {'name': 'point', 'type': 'relation', 'required': False,
             'maxSelect': 1, 'minSelect': 0,
             'collectionId': point['id'], 'cascadeDelete': False},
            # Chỉ dùng cho TI — để phân biệt đủ 3 pha.
            {'name': 'phase', 'type': 'select', 'required': False, 'maxSelect': 1,
             'values': ['A', 'B', 'C']},
            {'name': 'ratio_primary', 'type': 'number', 'required': False},
            {'name': 'ratio_secondary', 'type': 'number', 'required': False},
            {'name': 'model_desc', 'type': 'text', 'required': False},
            {'name': 'status', 'type': 'select', 'required': False, 'maxSelect': 1,
             'values': ['dang_treo', 'kho', 'thao_go', 'thanh_ly']},
            {'name': 'note', 'type': 'text', 'required': False},
            {'name': 'created', 'type': 'autodate', 'onCreate': True, 'onUpdate': False},
            {'name': 'updated', 'type': 'autodate', 'onCreate': True, 'onUpdate': True},
        ],
        'indexes': [
            'CREATE UNIQUE INDEX `idx_uniq_dm_asset_serial` ON `dm_asset` (`serial`)',
            'CREATE INDEX `idx_dm_asset_point` ON `dm_asset` (`point`)',
            'CREATE INDEX `idx_dm_asset_type` ON `dm_asset` (`type`)',
        ],
        'listRule': AUTH_RULE, 'viewRule': AUTH_RULE,
        'createRule': AUTH_RULE, 'updateRule': AUTH_RULE, 'deleteRule': AUTH_RULE,
    }

    print(f'PB: {PB_URL}')
    print(f'Sẽ tạo dm_asset ({len(spec["fields"])} field)')
    if DRY_RUN:
        print('[DRY-RUN] Không ghi gì.')
        return

    r = call('POST', '/api/collections', token, spec)
    print(f'  ✓ dm_asset: đã tạo (id {r["id"]})')

    after = collections(token)
    print('\nĐối chiếu collection có sẵn:')
    bad = False
    for name in sorted(PROTECTED):
        b, a = before.get(name), after.get(name)
        if a is None or json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
            print(f'  ✗ {name}: BỊ THAY ĐỔI'); bad = True
        else:
            print(f'  ✓ {name}: nguyên vẹn')
    print(f'\nTổng collection: {len(before)} → {len(after)}')
    if bad:
        raise SystemExit('LỖI: có collection cũ bị đụng vào.')


if __name__ == '__main__':
    main()
