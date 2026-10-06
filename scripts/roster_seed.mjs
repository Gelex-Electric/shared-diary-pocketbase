#!/usr/bin/env node
/**
 * Nạp dữ liệu ban đầu cho lịch trực tháng (plan `plans/2026-10-06-lich-truc-thang.md`, bước 3):
 *  1. `power_staff`: mọi tên điều độ đã xuất hiện trong `handovers` (tên đã chuẩn hoá 06/10/2026),
 *     theo từng KCN. IDnum theo thứ tự xuất hiện trong 60 ngày gần nhất (chính rồi phụ, theo ca)
 *     để danh sách đọc ra đúng thứ tự các cặp xoay; tên cũ hơn xếp sau.
 *  2. `shift_roster`: dựng lịch cho MỌI tháng từ `handovers` — mỗi (khu vực, ngày, ca) lấy 4 tên.
 *     Ca nhập trùng → lấy bản `updated` mới nhất (ghi CSV để user xem). Bỏ bản ghi sai năm
 *     (ngoài 2025-12..2026-12) — liệt kê riêng.
 * Chỉ TẠO bản ghi còn thiếu, không ghi đè bản đã có → chạy lại an toàn.
 *
 * Mặc định dry-run. `--apply` mới ghi.
 *   railway run -- node scripts/roster_seed.mjs --out <thư-mục> [--apply]
 *
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import fs from 'node:fs';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const OUT = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !OUT) { console.error('Thiếu --out <thư-mục>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) { console.error('Thiếu tài khoản PocketBase (chạy qua `railway run`).'); process.exit(1); }

const api = async (path, opts = {}) => {
  const r = await fetch(`${PB}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const auth = await api('/api/collections/_superusers/auth-with-password', { method: 'POST', body: JSON.stringify({ identity: email, password }) });
const H = { Authorization: auth.token };
const getAll = async col => {
  const all = [];
  for (let page = 1; ; page++) {
    const r = await api(`/api/collections/${col}/records?perPage=500&page=${page}`, { headers: H });
    all.push(...r.items);
    if (page >= r.totalPages) return all;
  }
};
/* Ghi song song có giới hạn (8 luồng) — 3.400 bản ghi tuần tự mất ~20 phút. */
const pool = async (items, fn, n = 8) => {
  let i = 0, ok = 0; const errs = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); ok++; } catch (e) { errs.push(String(e.message || e)); } }
  }));
  return { ok, errs };
};

const clean = s => (s || '').normalize('NFC').trim().replace(/\s+/g, ' ');
const q = v => `"${String(v).replace(/"/g, '""')}"`;
const [logs, power, roster] = await Promise.all([getAll('handovers'), getAll('power_staff'), getAll('shift_roster')]);
console.log(`handovers ${logs.length} · power_staff hiện có ${power.length} · shift_roster hiện có ${roster.length}`);

/* 1. power_staff */
const day = r => r.startdate.slice(0, 10);
const byArea = {};
for (const r of logs) (byArea[r.area] ??= []).push(r);
const newPower = [];
for (const [area, rs] of Object.entries(byArea)) {
  rs.sort((a, b) => a.startdate.localeCompare(b.startdate));
  const lastDay = rs.filter(r => day(r) <= '2026-12-31').at(-1).startdate.slice(0, 10);
  const from = new Date(`${lastDay}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 60);
  const order = [];
  for (const r of rs.filter(r => day(r) >= from.toISOString().slice(0, 10)))
    for (const f of ['main_power', 'sub_power']) { const v = clean(r[f]); if (v && !order.includes(v)) order.push(v); }
  const rest = [...new Set(rs.flatMap(r => [clean(r.main_power), clean(r.sub_power)]).filter(v => v && !order.includes(v)))].sort((a, b) => a.localeCompare(b, 'vi'));
  const have = new Set(power.filter(p => p.area === area).map(p => clean(p.Name)));
  [...order, ...rest].forEach((Name, i) => { if (!have.has(Name)) newPower.push({ area, Name, IDnum: i + 1 }); });
  console.log(`  ${area}: ${order.length + rest.length} điều độ (${order.length} đang xoay 60 ngày gần nhất${rest.length ? `; cũ: ${rest.join(', ')}` : ''})`);
}

/* 2. shift_roster */
const valid = r => day(r) >= '2025-12-01' && day(r) <= '2026-12-31' && ['Ca 1', 'Ca 2', 'Ca 3'].includes(r.shift);
const bad = logs.filter(r => !valid(r));
const slots = new Map();
for (const r of logs.filter(valid)) {
  const k = `${r.area}|${day(r)}|${r.shift}`;
  (slots.get(k) ?? slots.set(k, []).get(k)).push(r);
}
const dupRows = [];
const have = new Set(roster.map(r => `${r.area}|${r.date}|${r.shift}`));
const newRoster = [];
for (const [k, list] of slots) {
  list.sort((a, b) => b.updated.localeCompare(a.updated));
  const pick = list[0];
  if (list.length > 1) for (const x of list) dupRows.push([pick === x ? 'CHỌN' : 'bỏ qua', x.area, day(x), x.shift, x.main_duty, x.sub_duty, x.main_power, x.sub_power, x.updated, x.id]);
  if (have.has(k)) continue;
  newRoster.push({ area: pick.area, date: day(pick), shift: pick.shift,
    main_duty: clean(pick.main_duty), sub_duty: clean(pick.sub_duty), main_power: clean(pick.main_power), sub_power: clean(pick.sub_power) });
}
fs.writeFileSync(join(OUT, 'ca_nhap_trung.csv'), '﻿' + [['', 'Khu vực', 'Ngày', 'Ca', 'Trực chính', 'Trực phụ', 'Điều độ chính', 'Điều độ phụ', 'Sửa lần cuối', 'Record ID'], ...dupRows].map(r => r.map(q).join(',')).join('\r\n'));
fs.writeFileSync(join(OUT, 'ca_sai_ngay.csv'), '﻿' + [['Khu vực', 'startdate', 'Ca', 'Record ID'], ...bad.map(r => [r.area, r.startdate, r.shift, r.id])].map(r => r.map(q).join(',')).join('\r\n'));
const perArea = newRoster.reduce((m, r) => (m[r.area] = (m[r.area] || 0) + 1, m), {});
console.log(`\npower_staff sẽ tạo: ${newPower.length}`);
console.log(`shift_roster sẽ tạo: ${newRoster.length} ca`, perArea);
console.log(`Ca nhập trùng: ${dupRows.filter(r => r[0] === 'CHỌN').length} (ca_nhap_trung.csv) · bản ghi sai ngày bỏ qua: ${bad.length} (ca_sai_ngay.csv)`);
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

const p1 = await pool(newPower, b => api('/api/collections/power_staff/records', { method: 'POST', headers: H, body: JSON.stringify(b) }));
console.log(`power_staff: tạo ${p1.ok}/${newPower.length}`, p1.errs.slice(0, 3));
const p2 = await pool(newRoster, b => api('/api/collections/shift_roster/records', { method: 'POST', headers: H, body: JSON.stringify(b) }));
console.log(`shift_roster: tạo ${p2.ok}/${newRoster.length}`, p2.errs.slice(0, 3));
if (p1.errs.length || p2.errs.length) process.exit(1);
