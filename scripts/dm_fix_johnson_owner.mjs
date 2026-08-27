#!/usr/bin/env node
/**
 * Trả mã điểm đo JOHNSON về `TTI.JOHNSON2.T1.3000kVA` và ghi lịch sử chuyển chủ.
 *
 * Bối cảnh: KCNTTI-005 (JOHNSON2) hợp nhất vào KCNTTI-004 (JOHNSON1) từ kỳ hóa
 * đơn 21/07/2026. Khi đổi khách hàng trong form, mã tự mọc thêm đuôi tên tắt
 * chủ mới thành `…3000kVA.JOHNSON1` — trong khi điểm đo vật lý không đổi và mã
 * này chính là `LINE_NAME` bên HES.
 *
 * Script làm đúng những gì tính năng "Chuyển chủ thể" làm, cho bản ghi đã lỡ
 * đổi mã trước khi có tính năng đó (user chốt 27/08/2026).
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_fix_johnson_owner.mjs --dry-run
 */
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const DRY_RUN = process.argv.includes('--dry-run');

const WANT_CODE = 'TTI.JOHNSON2.T1.3000kVA';
const TRANSFER = { from: 'KCNTTI-005', to: 'KCNTTI-004', date: '2026-07-21', reason: 'hợp nhất pháp nhân' };

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token, 'Content-Type': 'application/json' };
const allOf = async col => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await (await fetch(`${PB}/api/collections/${col}/records?perPage=500&page=${page}`, { headers: H })).json();
    out.push(...(r.items ?? []));
    if (page >= (r.totalPages ?? 1)) return out;
  }
};

const points = await allOf('dm_point');
const customers = await allOf('dm_customer');
const mkhOf = id => customers.find(c => c.id === id)?.mkh ?? '—';

const p = points.find(x => x.code === `${WANT_CODE}.JOHNSON1`) || points.find(x => x.code === WANT_CODE);
if (!p) { console.error('Không thấy điểm đo JOHNSON2 T1 3000kVA.'); process.exit(1); }

console.log(`PB ${PB}`);
console.log('TRƯỚC:');
console.log(`   code         ${p.code}`);
console.log(`   line_name    ${p.line_name}`);
console.log(`   sub_label    ${p.sub_label || '(rỗng)'}`);
console.log(`   customer     ${mkhOf(p.customer)}`);
console.log(`   owner_history ${JSON.stringify(p.owner_history ?? [])}`);

if (mkhOf(p.customer) !== TRANSFER.to) {
  console.error(`DỪNG: khách hàng hiện tại là ${mkhOf(p.customer)}, không phải ${TRANSFER.to}.`);
  process.exit(1);
}
const clash = points.find(x => x.code === WANT_CODE && x.id !== p.id);
if (clash) { console.error(`DỪNG: mã ${WANT_CODE} đã thuộc điểm đo khác (${clash.id}).`); process.exit(1); }

const history = Array.isArray(p.owner_history) ? p.owner_history : [];
const already = history.some(h => h.date === TRANSFER.date && h.to === TRANSFER.to);
const noteLine = `21/07/2026: chuyển chủ thể ${TRANSFER.from} → ${TRANSFER.to} (${TRANSFER.reason})`;

const body = {
  code: WANT_CODE,
  line_name: WANT_CODE,
  sub_label: '',
  owner_history: already ? history : [...history, TRANSFER],
  note: (p.note ?? '').includes('chuyển chủ thể')
    ? p.note
    : [p.note?.trim(), noteLine].filter(Boolean).join('\n'),
};

console.log('\nSAU:');
for (const [k, v] of Object.entries(body)) console.log(`   ${k.padEnd(13)} ${typeof v === 'string' ? v.replace(/\n/g, ' | ') : JSON.stringify(v)}`);

if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); process.exit(0); }

const res = await fetch(`${PB}/api/collections/dm_point/records/${p.id}`, {
  method: 'PATCH', headers: H, body: JSON.stringify(body),
});
if (!res.ok) { console.error(`HTTP ${res.status}\n${await res.text()}`); process.exit(1); }
const after = await res.json();
console.log(`\n  ✓ Đã cập nhật. code = ${after.code} · owner_history = ${JSON.stringify(after.owner_history)}`);
console.log(`Tổng điểm đo: ${(await allOf('dm_point')).length} (phải vẫn là ${points.length})`);
