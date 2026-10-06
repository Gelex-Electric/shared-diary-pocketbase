/**
 * Phân ca LẠI toàn bộ lịch đã có theo mô hình kíp (user yêu cầu 06/10/2026).
 *
 * Mỗi khu vực: với mọi ca đang có trong `shift_roster` (và các ca `handovers` tương ứng), trực
 * đội = `dutyFor(nhân sự hiện tại, ngày, ca)` — kíp nối nhau liên tục từ Ca 1 ngày 01/01/2026
 * (kíp A, giống mốc file Excel), trực phụ dịch 1 kíp mỗi tháng. Lịch liên tục nên không cần
 * nối tháng. Điều độ (main_power/sub_power) GIỮ NGUYÊN — đó là lịch thật của Điện lực.
 * Kiểm `validateRoster` trên toàn bộ lịch sau khi xếp; còn lỗi trực đội → dừng, không ghi.
 *
 *   railway run -- npx tsx scripts/roster_regen.ts --out <thư-mục> [--apply]
 * Mặc định dry-run. `--apply`: sao lưu JSON `shift_roster` + `handovers` trước rồi mới ghi.
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { dutyFor, validateRoster, crewsOf, crewLetter, normName, MIN_DUTY_STAFF } from '../src/lib/dutyRotation';
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
const pool = async <T>(items: T[], fn: (x: T) => Promise<unknown>, n = 8) => {
  let i = 0, ok = 0; const errs: string[] = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); ok++; } catch (e) { errs.push(String((e as Error).message)); } }
  }));
  return { ok, errs };
};

const [roster, logs, staff] = await Promise.all([getAll<ShiftRoster>('shift_roster'), getAll<Handover>('handovers'), getAll<ElectricShift>('Electric_shift')]);
console.log(`shift_roster ${roster.length} · handovers ${logs.length} · Electric_shift ${staff.length}`);

const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
const rows: string[][] = [];
const rosterPatch: { id: string; main_duty: string; sub_duty: string }[] = [];
const logPatch: { id: string; main_duty: string; sub_duty: string }[] = [];
let blocked = false;

for (const area of [...new Set(roster.map(r => r.area))].sort()) {
  const st = staff.filter(s => s.area === area);
  const { K, mains, subs } = crewsOf(st);
  if (st.length < MIN_DUTY_STAFF) { console.error(`${area}: chỉ ${st.length} người — bỏ qua`); continue; }
  const rs = roster.filter(r => r.area === area).sort((a, b) => (a.date + a.shift).localeCompare(b.date + b.shift));
  const next = rs.map(r => ({ ...r, ...dutyFor(st, r.date, r.shift) }));
  const issues = validateRoster(next).filter(i => i.kind !== 'empty' && i.role.endsWith('duty'));
  const powerIssues = validateRoster(next).filter(i => i.kind === 'consecutive' && i.role.endsWith('power'));
  if (issues.length) { blocked = true; console.error(`${area}: ${issues.length} lỗi trực đội`, issues.slice(0, 3)); }
  let changed = 0;
  next.forEach((n, idx) => {
    const r = rs[idx];
    if (normName(r.main_duty) !== normName(n.main_duty) || normName(r.sub_duty) !== normName(n.sub_duty)) {
      changed++;
      rosterPatch.push({ id: r.id, main_duty: n.main_duty, sub_duty: n.sub_duty });
      rows.push([area, r.date, r.shift, r.main_duty, r.sub_duty, n.main_duty, n.sub_duty]);
    }
  });
  const byKey = new Map(next.map(n => [`${n.date}|${n.shift}`, n]));
  let logChanged = 0, logNoRoster = 0;
  for (const l of logs.filter(l => l.area === area)) {
    const n = byKey.get(`${l.startdate.slice(0, 10)}|${l.shift}`);
    if (!n) { logNoRoster++; continue; }
    if (normName(l.main_duty) !== normName(n.main_duty) || normName(l.sub_duty) !== normName(n.sub_duty)) {
      logChanged++;
      logPatch.push({ id: l.id, main_duty: n.main_duty, sub_duty: n.sub_duty });
    }
  }
  console.log(`\n${area}: ${st.length} người, ${K} kíp (${mains.map((m, j) => `${crewLetter(j)}=${m.Name}+${subs[j].Name}`).join(', ')})`);
  console.log(`  lịch ${rs.length} ca (${rs[0]?.date} → ${rs.at(-1)?.date}) · đổi ${changed} · handovers đổi ${logChanged}${logNoRoster ? ` · ${logNoRoster} ca không có trong lịch (sai ngày) — giữ nguyên` : ''}`);
  console.log(`  kiểm tra sau khi xếp: trực đội ${issues.length} lỗi · điều độ (giữ nguyên) ${powerIssues.length} ca trùng liên tiếp`);
}

/* Chéo KCN: một người đứng tên ở nhiều KCN → có thể bị xếp cùng ca hoặc 2 ca liền ở 2 nơi */
const patchById = new Map(rosterPatch.map(p => [p.id, p]));
for (const [label, after] of [['HIỆN TẠI', roster], ['SAU KHI XẾP', roster.map(r => ({ ...r, ...(patchById.get(r.id) ?? {}) }))]] as const) {
  const at = new Map<string, string[]>(); // `${tên}|${ngày}|${ca}` → các KCN
  for (const r of after) for (const n of [r.main_duty, r.sub_duty]) {
    const k = `${normName(n)}|${r.date}|${r.shift}`;
    at.set(k, [...(at.get(k) ?? []), r.area]);
  }
  const same = [...at].filter(([, a]) => a.length > 1);
  const order = ['Ca 1', 'Ca 2', 'Ca 3'];
  let consec = 0;
  for (const [k, a] of at) {
    const [n, d, s] = k.split('|');
    const i = order.indexOf(s);
    const nd = i < 2 ? d : new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
    const nxt = at.get(`${n}|${nd}|${order[(i + 1) % 3]}`);
    if (nxt && nxt.some(x => !a.includes(x) || a.length > 1)) consec++;
  }
  console.log(`\nCHÉO KCN (trực đội, ${label}): ${same.length} lần 1 người trực CÙNG CA ở ≥2 KCN · ${consec} lần 2 ca liền ở 2 KCN khác nhau`);
  same.slice(0, 5).forEach(([k, a]) => console.log(`   ${k} → ${a.join(', ')}`));
}

fs.writeFileSync(join(OUT, 'regen_plan.csv'), '﻿' + [['Khu vực', 'Ngày', 'Ca', 'Trực chính cũ', 'Trực phụ cũ', 'Trực chính mới', 'Trực phụ mới'], ...rows].map(r => r.map(q).join(',')).join('\r\n'));
console.log(`\nTổng: shift_roster đổi ${rosterPatch.length} ca · handovers đổi ${logPatch.length} ca · chi tiết regen_plan.csv`);
if (blocked) { console.error('CÒN LỖI TRỰC ĐỘI — KHÔNG GHI.'); process.exit(1); }
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

fs.writeFileSync(join(OUT, `backup_shift_roster_${Date.now()}.json`), JSON.stringify(roster));
fs.writeFileSync(join(OUT, `backup_handovers_${Date.now()}.json`), JSON.stringify(logs));
const p1 = await pool(rosterPatch, ({ id, ...b }) => api(`/api/collections/shift_roster/records/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) }));
console.log(`shift_roster: ghi ${p1.ok}/${rosterPatch.length}`, p1.errs.slice(0, 3));
const p2 = await pool(logPatch, ({ id, ...b }) => api(`/api/collections/handovers/records/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(b) }));
console.log(`handovers: ghi ${p2.ok}/${logPatch.length}`, p2.errs.slice(0, 3));
if (p1.errs.length || p2.errs.length) process.exit(1);
