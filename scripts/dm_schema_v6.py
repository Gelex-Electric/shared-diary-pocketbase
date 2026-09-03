#!/usr/bin/env python3
"""
Schema đợt 6 — bỏ cột `phase` khỏi `dm_asset` (user yêu cầu 14/08/2026).

Cột này thêm ở đợt 5 để phân biệt 3 TI theo pha A/B/C. Sau đó user bỏ cột Pha
khỏi bảng khai vật tư nên nó thành cột chết → dọn cho sạch.

XOÁ FIELD LÀ THAO TÁC MẤT DỮ LIỆU: script tự đếm bản ghi còn giá trị ở `phase`
và DỪNG nếu có, trừ khi chạy kèm `--force`.

NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_asset`. KHÔNG chạm 9 collection có sẵn.
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
FORCE = '--force' in sys.argv

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


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD')

    token = call('POST', '/api/collections/_superusers/auth-with-password',
                 body={'identity': EMAIL, 'password': PASSWORD})['token']
    before = collections(token)
    asset = before.get('dm_asset')
    if not asset:
        raise SystemExit('Chưa có dm_asset — chạy scripts/dm_schema_v5.py trước.')

    if not any(f['name'] == 'phase' for f in asset['fields']):
        print('= dm_asset.phase: không còn, không làm gì.')
        return

    # Đếm bản ghi còn dữ liệu ở cột sắp xoá.
    recs = call('GET', '/api/collections/dm_asset/records?perPage=500', token)
    dirty = [r for r in recs['items'] if r.get('phase')]
    print(f'PB: {PB_URL}')
    print(f'dm_asset: {recs["totalItems"]} bản ghi, {len(dirty)} bản ghi còn giá trị ở cột `phase`')
    for r in dirty[:10]:
        print(f'   {r["serial"]} ({r["type"]}) phase={r["phase"]}')

    if dirty and not FORCE:
        raise SystemExit('DỪNG: xoá cột sẽ mất dữ liệu trên. Chạy lại kèm --force nếu vẫn muốn.')

    fields = [f for f in asset['fields'] if f['name'] != 'phase']
    print('Sẽ xoá dm_asset.phase')
    if DRY_RUN:
        print('[DRY-RUN] Không ghi gì.')
        return

    call('PATCH', f"/api/collections/{asset['id']}", token, {'fields': fields})
    print('  ✓ dm_asset: đã xoá cột phase')

    after = collections(token)
    print('\nĐối chiếu collection có sẵn:')
    bad = False
    for name in sorted(PROTECTED):
        b, a = before.get(name), after.get(name)
        if a is None or json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
            print(f'  ✗ {name}: BỊ THAY ĐỔI'); bad = True
        else:
            print(f'  ✓ {name}: nguyên vẹn')
    print('\ndm_asset: ' + ', '.join(
        f['name'] for f in after['dm_asset']['fields'] if f['name'] != 'id'))
    if bad:
        raise SystemExit('LỖI: có collection cũ bị đụng vào.')


if __name__ == '__main__':
    main()
