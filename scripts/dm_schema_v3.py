#!/usr/bin/env python3
"""
Schema đợt 3 — cho điểm đo (user yêu cầu 14/08/2026).

  dm_point : + code          (mã điểm đo hệ thống sinh, unique)
             + ident         (định danh điểm đo, vd "0,4" → hiện thành "(0,4)")
             + parent_point  (relation → dm_point; điểm đo phụ trỏ về điểm chính)
             ~ line_id       required → tuỳ chọn, BỎ unique index, thay bằng index thường
             ~ line_name     required → tuỳ chọn (tự điền = code khi lưu)

Vì sao bỏ unique của `line_id`: LINE_ID là mã bên HES, lúc khai điểm đo thường
chưa có. Để required+unique thì bản ghi thứ hai bỏ trống sẽ đụng index (chuỗi
rỗng vẫn là một giá trị). Mã định danh duy nhất từ nay là `code`.

Mã điểm đo:
  chính : <hậu tố KCN>.<tên tắt KH của trạm>.<định danh trạm>.<công suất>kVA(<định danh điểm đo>)
  phụ   : <hậu tố KCN>.<tên tắt KH của trạm>.<tên tắt KH phụ>.<định danh trạm>.<công suất>kVA(...)

NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_point`. KHÔNG chạm 9 collection có sẵn.

Chạy:
    PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... python scripts/dm_schema_v3.py [--dry-run]
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


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD')

    token = call('POST', '/api/collections/_superusers/auth-with-password',
                 body={'identity': EMAIL, 'password': PASSWORD})['token']
    before = collections(token)
    if 'dm_point' not in before:
        raise SystemExit('Chưa có dm_point — chạy scripts/dm_schema.py trước.')

    point = before['dm_point']
    n = call('GET', '/api/collections/dm_point/records?perPage=1', token)['totalItems']
    print(f'PB: {PB_URL}')
    print(f'dm_point đang có {n} bản ghi\n')

    fields = [dict(f) for f in point['fields']]
    notes = []

    for f in fields:
        if f['name'] == 'line_id' and f.get('required'):
            f['required'] = False; notes.append('~ line_id: bỏ bắt buộc')
        elif f['name'] == 'line_name' and f.get('required'):
            f['required'] = False; notes.append('~ line_name: bỏ bắt buộc')

    def has(name):
        return any(f['name'] == name for f in fields)

    if not has('code'):
        # Đặt lên đầu cho dễ nhìn trong Admin UI.
        fields.insert(1, {'name': 'code', 'type': 'text', 'required': False})
        notes.append('+ code')
    if not has('ident'):
        idx = next(i for i, f in enumerate(fields) if f['name'] == 'code')
        fields.insert(idx + 1, {'name': 'ident', 'type': 'text', 'required': False})
        notes.append('+ ident')
    if not has('parent_point'):
        fields.append({
            'name': 'parent_point', 'type': 'relation', 'required': False,
            'maxSelect': 1, 'minSelect': 0,
            'collectionId': point['id'], 'cascadeDelete': False,
        })
        notes.append('+ parent_point (tự trỏ dm_point)')

    # Index: bỏ unique của line_id, thêm unique cho code + index cho parent_point.
    indexes = [i for i in point['indexes'] if 'idx_uniq_dm_point_line_id' not in i]
    if len(indexes) != len(point['indexes']):
        indexes.append('CREATE INDEX `idx_dm_point_line_id` ON `dm_point` (`line_id`)')
        notes.append('~ line_id: unique → index thường')
    if not any('idx_uniq_dm_point_code' in i for i in indexes):
        indexes.append('CREATE UNIQUE INDEX `idx_uniq_dm_point_code` ON `dm_point` (`code`)')
        notes.append('+ unique index cho code')
    if not any('idx_dm_point_parent' in i for i in indexes):
        indexes.append('CREATE INDEX `idx_dm_point_parent` ON `dm_point` (`parent_point`)')

    if not notes:
        print('Không có gì để làm.')
        return

    print('Sẽ thay đổi dm_point:')
    for x in notes:
        print(f'  * {x}')
    if DRY_RUN:
        print('\n[DRY-RUN] Không ghi gì.')
        return

    call('PATCH', f"/api/collections/{point['id']}", token,
         {'fields': fields, 'indexes': indexes})
    print('  ✓ dm_point: đã cập nhật')

    after = collections(token)
    print('\nĐối chiếu collection có sẵn (phải KHÔNG đổi):')
    bad = False
    for name in sorted(PROTECTED):
        b, a = before.get(name), after.get(name)
        if a is None or json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
            print(f'  ✗ {name}: BỊ THAY ĐỔI/BIẾN MẤT'); bad = True
        else:
            print(f'  ✓ {name}: nguyên vẹn')

    print('\ndm_point: ' + ', '.join(
        f['name'] for f in after['dm_point']['fields'] if f['name'] != 'id'))
    if bad:
        raise SystemExit('LỖI: có collection cũ bị đụng vào.')


if __name__ == '__main__':
    main()
