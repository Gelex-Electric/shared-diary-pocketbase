#!/usr/bin/env python3
"""
Schema đợt 4 — nhãn đuôi của điểm đo phụ (user yêu cầu 14/08/2026).

  dm_point : + sub_label   (đoạn cuối mã của điểm đo phụ)

Đuôi mã điểm đo phụ có thể là một trong hai:
  - Tên tắt của KH phụ, khi điểm phụ khác khách hàng với điểm chính.
  - Nhãn mục đích viết tắt (CSCC, BCC, TRAM-BOM, VP, DP hoặc tự nhập), khi
    điểm phụ TRÙNG khách hàng với điểm chính — lúc đó lấy tên tắt KH sẽ trùng
    y hệt phần đầu mã, không phân biệt được.

Lưu lại đoạn đã dùng để mở sửa còn dựng lại đúng, không phải suy ngược từ mã.

Mã điểm đo phụ:  <hậu tố KCN>.<tên tắt KH trạm>.<định danh trạm>.<công suất>kVA.<sub_label>(<định danh điểm đo>)

NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_point`. KHÔNG chạm 9 collection có sẵn.
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
    point = before.get('dm_point')
    if not point:
        raise SystemExit('Chưa có dm_point — chạy scripts/dm_schema.py trước.')

    if any(f['name'] == 'sub_label' for f in point['fields']):
        print('= dm_point.sub_label: đã có, không làm gì.')
        return

    fields = [dict(f) for f in point['fields']]
    idx = next(i for i, f in enumerate(fields) if f['name'] == 'ident')
    fields.insert(idx + 1, {'name': 'sub_label', 'type': 'text', 'required': False})

    print('Sẽ thêm dm_point.sub_label')
    if DRY_RUN:
        print('[DRY-RUN] Không ghi gì.')
        return

    call('PATCH', f"/api/collections/{point['id']}", token, {'fields': fields})
    print('  ✓ dm_point: đã cập nhật')

    after = collections(token)
    bad = False
    print('\nĐối chiếu collection có sẵn:')
    for name in sorted(PROTECTED):
        b, a = before.get(name), after.get(name)
        if a is None or json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
            print(f'  ✗ {name}: BỊ THAY ĐỔI'); bad = True
        else:
            print(f'  ✓ {name}: nguyên vẹn')
    print('\ndm_point: ' + ', '.join(
        f['name'] for f in after['dm_point']['fields'] if f['name'] != 'id'))
    if bad:
        raise SystemExit('LỖI: có collection cũ bị đụng vào.')


if __name__ == '__main__':
    main()
