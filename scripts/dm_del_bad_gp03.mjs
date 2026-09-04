#!/usr/bin/env node
/**
 * Xoá các GP-03 có SỐ NO SAI DẠNG khỏi `dm_device`.
 *
 * IMEI của GP-03 luôn 15 chữ số. Trong kho đang có mấy cái mang số 10 chữ số
 * kiểu `2542202456` — đó là dạng số công tơ/TI, không phải IMEI, nên hoặc gõ
 * nhầm hoặc ghi nhầm loại. Chúng chưa từng lắp ở đâu nên xoá là sạch.
 *
 * KHÔNG đụng GP-03 15 chữ số dù đầu số không phải `869`: `867…`, `860…` là
 * TAC hợp lệ của hãng khác, và mấy cái đó đang lắp thật ở điểm đo có ngày treo.
 * Xoá là mất lịch sử đo xa của điểm đo.
 *
 * Chỉ xoá thiết bị KHÔNG có lần lắp nào. Có lần lắp thì dừng và báo.
 *
 * CHẠY THỬ mặc định. `--apply` mới xoá.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_del_bad_gp03.mjs
 */
const APPLY = process.argv.includes('--apply');
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

const allOf = async (col) => {
  const o = [];
  for (let p = 1; ; p++) {
    const r = await (await fetch(
      `${PB}/api/collections/${col}/records?perPage=500&page=${p}`, { headers: H })).json();
    o.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return o;
  }
};
const [devices, assets, points] = await Promise.all(['dm_device', 'dm_asset', 'dm_point'].map(allOf));
const codeOf = Object.fromEntries(points.map(p => [p.id, p.code || p.line_name || '—']));
const N = (s) => String(s ?? '').trim();

/** IMEI: đúng 15 chữ số. Đầu số nào cũng được — 867/860 là TAC hợp lệ. */
const IMEI = /^\d{15}$/;

const gp = devices.filter(d => d.type === 'GP03');
const bad = gp.filter(d => !IMEI.test(N(d.serial)));

const rowsOf = (d) => assets.filter(a => a.device === d.id || N(a.serial) === N(d.serial));
const del = bad.filter(d => rowsOf(d).length === 0);
const keep = bad.filter(d => rowsOf(d).length > 0);

console.log(`GP-03 trong kho : ${gp.length}`);
console.log(`Số No sai dạng  : ${bad.length}\n`);
console.log(`SẼ XOÁ (chưa từng lắp) : ${del.length}`);
for (const d of del) {
  console.log(`   ${N(d.serial).padEnd(16)} ${N(d.serial).length} số · "${d.hold_for_note ?? ''}"`);
}
if (keep.length) {
  console.log(`\nGIỮ LẠI vì đã có lần lắp : ${keep.length}`);
  for (const d of keep) {
    console.log(`   ${N(d.serial)} → ${rowsOf(d).map(a => codeOf[a.point]).join(', ')}`);
  }
}

/* Cảnh báo riêng: 15 số nhưng đầu số lệch hẳn so với phần còn lại của kho. */
const prefix = new Map();
for (const d of gp) {
  const p = N(d.serial).slice(0, 3);
  if (IMEI.test(N(d.serial))) prefix.set(p, (prefix.get(p) ?? 0) + 1);
}
const odd = [...prefix.entries()].filter(([, n]) => n <= 2);
if (odd.length) {
  console.log('\nĐÁNG NGỜ — đầu số hiếm, KHÔNG tự xoá, cần soi tay:');
  for (const [p, n] of odd) {
    const list = gp.filter(d => N(d.serial).startsWith(p) && IMEI.test(N(d.serial)));
    for (const d of list) {
      console.log(`   ${N(d.serial)} (đầu ${p}, chỉ ${n} cái) → `
        + `${rowsOf(d).map(a => codeOf[a.point]).join(', ') || 'chưa lắp'}`);
    }
  }
}

if (!APPLY) { console.log('\nCHẠY THỬ — chưa xoá gì. Thêm --apply để xoá thật.'); process.exit(0); }

let n = 0;
for (const d of del) {
  const r = await fetch(`${PB}/api/collections/dm_device/records/${d.id}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(`${d.serial}: ${JSON.stringify(await r.json())}`);
  console.log(`OK  xoá ${d.serial}`);
  n++;
}
console.log(`\nĐã xoá ${n} thiết bị.`);
