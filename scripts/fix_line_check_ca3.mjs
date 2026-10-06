#!/usr/bin/env node
/**
 * Không đi kiểm tra đường dây ở Ca 3 (user chốt 06/10/2026):
 *  - Ca 3: xoá mọi dòng "Kiểm tra đường dây / ĐZ …" trong `situations` (dòng riêng → bỏ cả mục;
 *    nằm lẫn trong ô nhiều dòng → chỉ bỏ dòng đó, giữ các dòng khác).
 *  - Ca 1, Ca 2 CÙNG NGÀY, cùng khu vực: chưa có dòng kiểm tra đường dây thì thêm
 *    "Kiểm tra đường dây <khu vực>" lúc 07:00 (Ca 1) / 15:00 (Ca 2) — giờ đa số ca đang ghi.
 *    Đã có thì giữ nguyên. Ca 1/Ca 2 chưa có bản ghi → liệt kê, không tạo ca mới.
 * Chỉ đụng `situations`. Mặc định dry-run; `--apply` sao lưu bản ghi bị sửa rồi mới ghi.
 *   railway run -- node scripts/fix_line_check_ca3.mjs --out <thư-mục> [--apply]
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import fs from 'node:fs';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const OUT = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !OUT) { console.error('Thiếu --out <thư-mục>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const api = async (path, opts = {}) => {
  const r = await fetch(PB + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const auth = await api('/api/collections/_superusers/auth-with-password', {
  method: 'POST', body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL, password: process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS }),
});
const H = { Authorization: auth.token };
const logs = [];
for (let page = 1; ; page++) {
  const r = await api(`/api/collections/handovers/records?perPage=500&page=${page}`, { headers: H });
  logs.push(...r.items);
  if (page >= r.totalPages) break;
}

const RE = /ki[ểe]m tra (đường dây|đz|dz)\b/i;
const isLine = t => RE.test((t || '').normalize('NFC'));
const hasLine = r => (r.situations || []).some(s => isLine(s.content));
const day = r => r.startdate.slice(0, 10);
const TIME = { 'Ca 1': '07:00', 'Ca 2': '15:00' };
const hhmm = t => (/^(\d{1,2})[:h](\d{2})/.exec(t || '') || []).slice(1).map(Number);

const patches = new Map(); // id -> { before, situations }
const rows = [];
const missing = [];
const bySlot = new Map();
for (const r of logs) { const k = `${r.area}|${day(r)}|${r.shift}`; (bySlot.get(k) ?? bySlot.set(k, []).get(k)).push(r); }

for (const r of logs.filter(r => r.shift === 'Ca 3' && hasLine(r))) {
  // 1. Xoá ở Ca 3
  const next = [];
  for (const s of r.situations) {
    const lines = (s.content || '').split('\n');
    if (!lines.some(isLine)) { next.push(s); continue; }
    const keep = lines.filter(l => !isLine(l));
    if (keep.some(l => l.trim())) next.push({ ...s, content: keep.join('\n') });
  }
  patches.set(r.id, { before: r, situations: next });
  rows.push([r.area, day(r), 'Ca 3', 'XOÁ', r.situations.filter(s => isLine(s.content)).map(s => s.content.split('\n').filter(isLine).join(' / ')).join(' / '), r.id]);
  // 2. Bổ sung Ca 1, Ca 2 cùng ngày
  for (const shift of ['Ca 1', 'Ca 2']) {
    const list = bySlot.get(`${r.area}|${day(r)}|${shift}`);
    if (!list) { missing.push([r.area, day(r), shift]); continue; }
    for (const t of list) {
      const cur = patches.get(t.id)?.situations ?? t.situations ?? [];
      if (cur.some(s => isLine(s.content))) continue;
      const add = { time: TIME[shift], content: `Kiểm tra đường dây ${r.area}` };
      // chèn theo giờ: sau các mục có giờ ≤ giờ mới (mục không có giờ giữ nguyên chỗ)
      const [h0, m0] = hhmm(add.time);
      let at = cur.length;
      for (let i = 0; i < cur.length; i++) {
        const [h, m] = hhmm(cur[i].time);
        if (h !== undefined && h * 60 + m > h0 * 60 + m0) { at = i; break; }
      }
      const situations = [...cur.slice(0, at), add, ...cur.slice(at)].filter(s => s.time || s.content);
      patches.set(t.id, { before: patches.get(t.id)?.before ?? t, situations });
      rows.push([t.area, day(t), shift, 'THÊM', `${add.time} ${add.content}`, t.id]);
    }
  }
}

const q = v => `"${String(v).replace(/"/g, '""')}"`;
fs.writeFileSync(join(OUT, 'line_ca3_plan.csv'), '﻿' + [['Khu vực', 'Ngày', 'Ca', 'Việc', 'Nội dung', 'Record ID'], ...rows].map(r => r.map(q).join(',')).join('\r\n'));
const n = k => rows.filter(r => r[3] === k).length;
console.log(`Ca 3 xoá dòng KT đường dây: ${n('XOÁ')} ca · bổ sung vào Ca 1/Ca 2: ${n('THÊM')} ca · tổng ${patches.size} bản ghi sửa`);
if (missing.length) console.log(`Ca 1/Ca 2 chưa có bản ghi (không bổ sung được): ${missing.length}`, missing.slice(0, 8).map(m => m.join(' ')).join(' | '));
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

fs.writeFileSync(join(OUT, `backup_${Date.now()}.json`), JSON.stringify([...patches.values()].map(p => p.before), null, 1));
let ok = 0;
for (const [id, { situations }] of patches) {
  await api(`/api/collections/handovers/records/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ situations }) });
  ok++;
}
console.log(`Đã ghi ${ok}/${patches.size} bản ghi.`);
