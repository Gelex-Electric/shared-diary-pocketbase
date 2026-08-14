#!/usr/bin/env python3
"""
Bổ sung schema đợt 2 cho nhóm `dm_*` (user yêu cầu 14/08/2026):

  dm_customer : + short_name  (tên tắt KH — viết liền, không dấu, cho phép '-')
  dm_station  : + customer    (relation → dm_customer; cần để sinh mã trạm)
                + ident       (định danh trạm: T1, T2, NX1…)
                ~ p0_kw → p0_w, pk_kw → pk_w   (đơn vị thật là W, không phải kW)

Mã trạm từ nay do hệ thống sinh, không gõ tay:
    <2 ký tự hậu tố KCN>.<tên tắt KH>.<định danh>.<công suất>kVA
    ví dụ  KCNTH + RICO + T1 + 2500  ->  TH.RICO.T1.2500kVA

NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng vào 2 collection `dm_*` do mình tạo.
KHÔNG chạm 9 collection nghiệp vụ có sẵn — có đối chiếu trước/sau.

Chạy:
    PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... python scripts/dm_schema_v2.py [--dry-run]
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


def count(token, name):
    return call('GET', f'/api/collections/{name}/records?perPage=1', token)['totalItems']


def main():
    if not EMAIL or not PASSWORD:
        raise SystemExit('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD')

    token = call('POST', '/api/collections/_superusers/auth-with-password',
                 body={'identity': EMAIL, 'password': PASSWORD})['token']
    before = collections(token)

    for need in ('dm_customer', 'dm_station'):
        if need not in before:
            raise SystemExit(f'Chưa có {need} — chạy scripts/dm_schema.py trước.')

    cust = before['dm_customer']
    stat = before['dm_station']
    n_station = count(token, 'dm_station')
    print(f'PB: {PB_URL}')
    print(f'dm_station đang có {n_station} bản ghi '
          f'({"an toàn để đổi tên field" if n_station == 0 else "CÓ DỮ LIỆU — cân nhắc"})\n')

    changes = []

    # ---------- dm_customer: thêm short_name ----------
    cf = [dict(f) for f in cust['fields']]
    if any(f['name'] == 'short_name' for f in cf):
        print('  = dm_customer.short_name: đã có, bỏ qua')
    else:
        # Chèn ngay sau `name` cho dễ nhìn trong Admin UI.
        idx = next((i for i, f in enumerate(cf) if f['name'] == 'name'), len(cf) - 2)
        cf.insert(idx + 1, {'name': 'short_name', 'type': 'text', 'required': False})
        changes.append(('dm_customer', cust['id'], {'fields': cf}, ['+ short_name']))

    # ---------- dm_station: thêm customer, ident; đổi tên p0/pk ----------
    sf = [dict(f) for f in stat['fields']]
    notes = []

    for f in sf:
        if f['name'] == 'p0_kw':
            f['name'] = 'p0_w'; notes.append('~ p0_kw -> p0_w')
        elif f['name'] == 'pk_kw':
            f['name'] = 'pk_w'; notes.append('~ pk_kw -> pk_w')

    if not any(f['name'] == 'customer' for f in sf):
        idx = next((i for i, f in enumerate(sf) if f['name'] == 'zone'), len(sf) - 2)
        sf.insert(idx + 1, {
            'name': 'customer', 'type': 'relation', 'required': False,
            'maxSelect': 1, 'minSelect': 0,
            'collectionId': cust['id'], 'cascadeDelete': False,
        })
        notes.append('+ customer')
    if not any(f['name'] == 'ident' for f in sf):
        idx = next((i for i, f in enumerate(sf) if f['name'] == 'customer'), len(sf) - 2)
        sf.insert(idx + 1, {'name': 'ident', 'type': 'text', 'required': False})
        notes.append('+ ident')

    if notes:
        changes.append(('dm_station', stat['id'], {'fields': sf}, notes))
    else:
        print('  = dm_station: đã đủ, bỏ qua')

    if not changes:
        print('\nKhông có gì để làm.')
        return

    print('Sẽ thay đổi:')
    for name, _, _, notes in changes:
        print(f'  * {name}: {", ".join(notes)}')

    if DRY_RUN:
        print('\n[DRY-RUN] Không ghi gì.')
        return

    for name, cid, body, _ in changes:
        call('PATCH', f'/api/collections/{cid}', token, body)
        print(f'  ✓ {name}: đã cập nhật')

    # ---------- đối chiếu 9 collection có sẵn ----------
    after = collections(token)
    print('\nĐối chiếu collection có sẵn (phải KHÔNG đổi):')
    bad = False
    for name in sorted(PROTECTED):
        b, a = before.get(name), after.get(name)
        if a is None or json.dumps(b, sort_keys=True) != json.dumps(a, sort_keys=True):
            print(f'  ✗ {name}: BỊ THAY ĐỔI/BIẾN MẤT'); bad = True
        else:
            print(f'  ✓ {name}: nguyên vẹn')

    print('\nSchema mới:')
    for name in ('dm_customer', 'dm_station'):
        print(f'  {name}: ' + ', '.join(
            f['name'] for f in after[name]['fields'] if f['name'] != 'id'))
    if bad:
        raise SystemExit('LỖI: có collection cũ bị đụng vào.')


if __name__ == '__main__':
    main()
