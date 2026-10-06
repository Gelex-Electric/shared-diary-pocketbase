/**
 * Sửa lỗi dữ liệu sổ trực còn tồn (user chốt 06/10/2026, sau kiểm tra tổng hợp):
 *  1. Yên Mỹ ghi "Kiểm tra đường dây KCN Số 03" (chép nhầm) → "KCN Yên Mỹ".
 *  2. Giờ ca sai → đặt giờ chuẩn theo ca (Ca 1 06–14, Ca 2 14–22, Ca 3 22–06 hôm sau), ngày giữ
 *     nguyên — CHỈ khi giờ trong diễn biến (situations) không mâu thuẫn với nhãn ca.
 *  3. Năm sai (0006, 2016 → 2026) + ngày kết thúc sai (gộp vào 2).
 *  4. Ca nhập trùng: đọc giờ trong `situations` suy ra ca thật. Bản nào suy ra ca khác và ô đó
 *     ĐANG TRỐNG → chuyển sang ca đó (giờ chuẩn), tạo ô `shift_roster` (trực đội theo mô hình kíp,
 *     điều độ lấy của chính bản ghi), đồng bộ tên trực đội. Ô cũ: điều độ lịch tháng = bản ở lại.
 *     Bản sao thật (cùng ca) KHÔNG xoá — chỉ liệt kê để user quyết.
 *
 *   railway run -- npx tsx scripts/fix_handover_misc.ts --out <thư-mục> [--apply]
 * Mặc định dry-run; `--apply` sao lưu bản ghi bị sửa trước. ⚠️ staging dùng chung PB production.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { dutyFor, addDays, SHIFT_TIMES, SHIFTS } from '../src/lib/dutyRotation';
import type { ElectricShift, Handover, ShiftRoster } from '../src/types';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const OUT = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !OUT) { console.error('Thiếu --out <thư-mục>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const api = async (path: string, opts: RequestInit = {}) => {
  const r = await fetch(PB + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers as object || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const auth = await api('/api/collections/_superusers/auth-with-password', {
  method: 'POST', body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL, password: process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS }),
});
const H = { Authorization: auth.token };
const getAll = async <T>(col: string): Promise<T[]> => {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const r = await api(`/api/collections/${col}/records?perPage=500&page=${page}`, { headers: H });
    all.push(...r.items);
    if (page >= r.totalPages) return all;
  }
};
const [logs, roster, staff] = await Promise.all([getAll<Handover>('handovers'), getAll<ShiftRoster>('shift_roster'), getAll<ElectricShift>('Electric_shift')]);

/* Suy ca từ giờ trong diễn biến (cột giờ, hoặc giờ đầu nội dung) — đa số phiếu */
const mins = (t?: string) => { const m = /(\d{1,2})\s*[:hH]\s*(\d{2})?/.exec(t || ''); return m ? +m[1] * 60 + +(m[2] || 0) : null; };
const shiftOfMin = (m: number) => (m >= 360 && m < 840 ? 'Ca 1' : m >= 840 && m < 1320 ? 'Ca 2' : 'Ca 3');
const inferShift = (r: Handover) => {
  const v: Record<string, number> = {};
  for (const s of r.situations || []) {
    const t = mins(s.time) ?? mins(/^\s*-?\s*(\d{1,2}[:hH]\d{2})/.exec(s.content || '')?.[1]);
    if (t != null) { const c = shiftOfMin(t); v[c] = (v[c] || 0) + 1; }
  }
  const best = Object.entries(v).sort((a, b) => b[1] - a[1]);
  return best.length && (best.length === 1 || best[0][1] > best[1][1]) ? best[0][0] : null;
};

const fixYear = (d: string) => (d < '2025-12-01' ? `2026${d.slice(4)}` : d);
const std = (date: string, shift: string) => {
  const [a, b] = SHIFT_TIMES[shift];
  return { startdate: `${date} ${a}:00.000Z`, enddate: `${shift === 'Ca 3' ? addDays(date, 1) : date} ${b}:00.000Z` };
};
const day = (r: Handover) => r.startdate.slice(0, 10);
const slotKey = (a: string, d: string, s: string) => `${a}|${d}|${s}`;

const patches = new Map<string, { before: Handover; patch: Partial<Handover> }>();
const P = (r: Handover, p: Partial<Handover>) => {
  const cur = patches.get(r.id) ?? { before: r, patch: {} };
  Object.assign(cur.patch, p); patches.set(r.id, cur);
};
const rows: string[][] = [];
const flags: string[] = [];

// 4. Nhập trùng → chuyển ca theo giờ diễn biến
const bySlot = new Map<string, Handover[]>();
for (const r of logs) { const k = slotKey(r.area, fixYear(day(r)), r.shift); (bySlot.get(k) ?? bySlot.set(k, []).get(k)!).push(r); }
const R = new Map(roster.map(r => [slotKey(r.area, r.date, r.shift), r]));
const rosterCreate: Omit<ShiftRoster, 'id' | 'created' | 'updated'>[] = [];
const rosterUpdate: { id: string; main_power: string; sub_power: string }[] = [];
const moved = new Set<string>();
const dupLeft: string[] = [];
for (const [k, list] of bySlot) {
  if (list.length < 2) continue;
  const [area, date, shift] = k.split('|');
  for (const r of list) {
    const real = inferShift(r);
    if (!real || real === shift || bySlot.has(slotKey(area, date, real)) || moved.has(slotKey(area, date, real))) continue;
    const duty = dutyFor(staff.filter(s => s.area === area), date, real);
    P(r, { shift: real, ...std(date, real), ...duty });
    moved.add(slotKey(area, date, real));
    rosterCreate.push({ area, date, shift: real, ...duty, main_power: r.main_power, sub_power: r.sub_power });
    rows.push(['4 chuyển ca', area, date, `${shift} → ${real}`, `giờ diễn biến: ${(r.situations || []).map(s => s.time).filter(Boolean).join(',')}`, r.id]);
  }
  const stay = list.filter(r => !patches.get(r.id)?.patch.shift);
  const ro = R.get(k);
  if (stay.length === 1 && ro && (ro.main_power !== stay[0].main_power || ro.sub_power !== stay[0].sub_power))
    rosterUpdate.push({ id: ro.id, main_power: stay[0].main_power, sub_power: stay[0].sub_power });
  if (stay.length > 1) dupLeft.push(`${k}: ${stay.map(r => r.id).join(', ')}`);
}

for (const r of logs) {
  const p = patches.get(r.id)?.patch ?? {};
  const shift = p.shift ?? r.shift;
  const date = fixYear(day(r));
  // 3 + 2. Năm sai / giờ ca sai → giờ chuẩn (nếu diễn biến không mâu thuẫn)
  const s = std(date, shift);
  if ((p.startdate ?? r.startdate) !== s.startdate || (p.enddate ?? r.enddate) !== s.enddate) {
    const real = inferShift(r);
    const alone = (bySlot.get(slotKey(r.area, date, r.shift))?.length ?? 1) === 1;
    // Ca duy nhất trong ô thì nhãn ca đáng tin hơn giờ gõ trong diễn biến → vẫn đặt giờ chuẩn, chỉ ghi chú
    if (real && real !== shift && !alone) flags.push(`${r.area} ${r.startdate.slice(0, 16)} ${shift}: diễn biến là ${real} — chưa sửa giờ (${r.id})`);
    else {
      if (real && real !== shift) flags.push(`${r.area} ${date} ${shift}: giờ trong diễn biến là của ${real} (gõ nhầm) — đã đặt giờ ca theo nhãn ${shift} (${r.id})`);
      P(r, s);
      rows.push([date !== day(r) ? '3 sửa năm' : '2 giờ chuẩn', r.area, date, shift, `${r.startdate.slice(0, 16)} → ${(r.enddate || '(trống)').slice(0, 16)} ⇒ ${s.startdate.slice(0, 16)} → ${s.enddate.slice(0, 16)}`, r.id]);
    }
  }
  // 1. Yên Mỹ ghi nhầm "KCN Số 03"
  if (r.area === 'KCN Yên Mỹ' && (r.situations || []).some(x => /KCN\s+số\s*0?3\b/i.test(x.content || ''))) {
    const situations = r.situations.map(x => ({ ...x, content: (x.content || '').split('\n').map(l => /ki[ểe]m tra (đường dây|đz|dz)/i.test(l.normalize('NFC')) ? l.replace(/KCN\s+số\s*0?3\b/i, 'KCN Yên Mỹ') : l).join('\n') }));
    if (JSON.stringify(situations) !== JSON.stringify(r.situations)) { P(r, { situations }); rows.push(['1 tên KCN', r.area, day(r), r.shift, 'KCN Số 03 → KCN Yên Mỹ', r.id]); }
  }
}

const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
fs.writeFileSync(join(OUT, 'misc_plan.csv'), '﻿' + [['Mục', 'Khu vực', 'Ngày', 'Ca', 'Chi tiết', 'Record ID'], ...rows].map(r => r.map(q).join(',')).join('\r\n'));
const cnt = rows.reduce((m, r) => (m[r[0]] = (m[r[0]] || 0) + 1, m), {} as Record<string, number>);
console.log('Kế hoạch:', cnt, `· ${patches.size} bản ghi handovers · lịch tháng: tạo ${rosterCreate.length}, sửa điều độ ${rosterUpdate.length}`);
rows.filter(r => r[0].startsWith('4') || r[0].startsWith('3')).forEach(r => console.log('  ', r.join(' | ')));
if (flags.length) { console.log(`Không sửa giờ vì diễn biến khác nhãn ca: ${flags.length}`); flags.slice(0, 10).forEach(f => console.log('   ', f)); }
console.log(`Bản sao thật còn lại (chưa xoá, chờ user): ${dupLeft.length}`); dupLeft.forEach(d => console.log('   ', d));
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

fs.writeFileSync(join(OUT, `backup_${Date.now()}.json`), JSON.stringify({ handovers: [...patches.values()].map(p => p.before), roster: rosterUpdate.map(u => R.get([...R].find(([, v]) => v.id === u.id)![0])) }, null, 1));
let ok = 0;
for (const [id, { patch }] of patches) { await api(`/api/collections/handovers/records/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) }); ok++; }
for (const b of rosterCreate) await api('/api/collections/shift_roster/records', { method: 'POST', headers: H, body: JSON.stringify(b) });
for (const { id, ...b } of rosterUpdate) await api(`/api/collections/shift_roster/records/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) });
console.log(`Đã ghi ${ok} handovers · lịch tháng tạo ${rosterCreate.length}, sửa ${rosterUpdate.length}.`);
void SHIFTS;
