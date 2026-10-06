/**
 * Sửa dữ liệu KCN Yên Mỹ (user yêu cầu 06/10/2026, sau kiểm tra tổng hợp):
 *  1. 02/10 Ca 2 thiếu điều độ phụ → điền theo chu kỳ (6/6 ca cùng loại xung quanh là cặp Nam + Cương).
 *  2. Ngày 26/08 không có lịch → tạo 3 ô `shift_roster` (trực đội theo kíp, điều độ theo chu kỳ).
 *     KHÔNG tạo ca trong `handovers` (nội dung ca phải do người trực nhập).
 *  3. Tháng 10 chưa có lịch → form "Tạo lịch trực" chặn lưu mọi ca từ 01/10. Tạo lịch tháng 10 bằng
 *     đúng thuật toán nút "Phân ca tự động" (buildMonthDuty + buildMonthPower, nối tiếp lịch trước).
 *  4. Giờ trong diễn biến nằm ngoài khung ca: gõ lệch 12 giờ (vd Ca 2 "02:00") → cộng/trừ 12 giờ
 *     nếu ra đúng khung ca; còn lại chỉ liệt kê.
 *
 *   railway run -- npx tsx scripts/fix_yenmy.ts --out <thư-mục> [--apply]
 * Mặc định dry-run; `--apply` sao lưu trước. ⚠️ staging dùng chung PB production.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { buildMonthDuty, dutyFor, validateRoster, addDays, daysOfMonth, SHIFTS } from '../src/lib/dutyRotation';
import { buildMonthPower, detectPowerPeriod } from '../src/lib/powerRotation';
import type { ElectricShift, Handover, RosterSlot, ShiftRoster } from '../src/types';

const AREA = 'KCN Yên Mỹ';
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
const f = encodeURIComponent(`area="${AREA}"`);
const getAll = async <T>(col: string): Promise<T[]> => {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const r = await api(`/api/collections/${col}/records?perPage=500&page=${page}&filter=${f}`, { headers: H });
    all.push(...r.items);
    if (page >= r.totalPages) return all;
  }
};
const [roster, logs, staff] = await Promise.all([getAll<ShiftRoster>('shift_roster'), getAll<Handover>('handovers'), getAll<ElectricShift>('Electric_shift')]);
const ord = (a: RosterSlot, b: RosterSlot) => (a.date + a.shift).localeCompare(b.date + b.shift);
roster.sort(ord);
const key = (d: string, s: string) => `${d}|${s}`;
const R = new Map(roster.map(r => [key(r.date, r.shift), r]));

/* Điều độ theo chu kỳ: bỏ phiếu 3 ca cùng loại mỗi phía, cách bội số P */
const P = detectPowerPeriod(roster)!;
const powerVote = (date: string, shift: string) => {
  const v = new Map<string, { m: string; s: string; n: number }>();
  for (let k = 1; k <= 3; k++) for (const dir of [-1, 1]) {
    const x = R.get(key(addDays(date, dir * k * P), shift));
    if (!x?.main_power || !x.sub_power) continue;
    const id = `${x.main_power}|${x.sub_power}`;
    v.set(id, { m: x.main_power, s: x.sub_power, n: (v.get(id)?.n ?? 0) + 1 });
  }
  return [...v.values()].sort((a, b) => b.n - a.n)[0];
};

const rUpdate: { id: string; patch: Partial<ShiftRoster>; before: ShiftRoster }[] = [];
const rCreate: Omit<ShiftRoster, 'id' | 'created' | 'updated'>[] = [];
const hUpdate: { id: string; patch: Partial<Handover>; before: Handover }[] = [];
const log: string[] = [];

// 1. Ô điều độ trống
for (const r of roster) {
  if (r.main_power && r.sub_power) continue;
  const v = powerVote(r.date, r.shift);
  if (!v || v.n < 4) { log.push(`1 ${r.date} ${r.shift}: chu kỳ không đủ chắc — bỏ qua`); continue; }
  const patch: Partial<ShiftRoster> = {};
  if (!r.main_power && v) patch.main_power = v.m;
  if (!r.sub_power && v) patch.sub_power = v.s;
  if (r.main_power && r.main_power !== v.m) { log.push(`1 ${r.date} ${r.shift}: điều độ chính ${r.main_power} khác chu kỳ ${v.m} — bỏ qua`); continue; }
  rUpdate.push({ id: r.id, patch, before: r });
  log.push(`1 điền điều độ ${r.date} ${r.shift}: ${JSON.stringify(patch)} (${v.n}/6 phiếu)`);
  for (const l of logs.filter(l => l.startdate.slice(0, 10) === r.date && l.shift === r.shift)) hUpdate.push({ id: l.id, patch, before: l });
}

// 2. Ngày trống ở giữa lịch (26/08)
const first = roster[0].date, last = roster.at(-1)!.date;
for (let d = first; d <= last; d = addDays(d, 1)) for (const s of SHIFTS) {
  if (R.has(key(d, s))) continue;
  const v = powerVote(d, s);
  const slot = { area: AREA, date: d, shift: s, ...dutyFor(staff, d, s), main_power: v?.m ?? '', sub_power: v?.s ?? '' };
  rCreate.push(slot); R.set(key(d, s), { ...slot, id: '', created: '', updated: '' });
  log.push(`2 tạo lịch ${d} ${s}: ${slot.main_duty}/${slot.sub_duty} · ${slot.main_power}/${slot.sub_power}${v ? ` (${v.n}/6 phiếu)` : ' (không dò được điều độ)'}`);
}

// 3. Lịch tháng 10 (giống nút Phân ca tự động)
const MONTH = '2026-10';
if (!roster.some(r => r.date.startsWith(MONTH))) {
  const history = [...R.values()].filter(r => r.date < `${MONTH}-01`).sort(ord).slice(-270);
  const duty = buildMonthDuty(staff, MONTH, history)!;
  const power = buildMonthPower(history, MONTH);
  duty.slots.forEach((s, i) => rCreate.push({ area: AREA, ...s, main_power: power.slots[i].main_power, sub_power: power.slots[i].sub_power }));
  log.push(`3 lịch tháng 10: ${duty.slots.length} ca · nối kíp ${duty.continued} · điều độ chu kỳ ${power.period} ngày`);
}

// Kiểm tra toàn bộ lịch sau khi sửa
const after = [...R.values()].map(r => ({ ...r, ...(rUpdate.find(u => u.id === r.id)?.patch ?? {}) }));
for (const c of rCreate.filter(c => c.date.startsWith(MONTH))) after.push({ ...c, id: '', created: '', updated: '' });
after.sort(ord);
const iss = validateRoster(after).filter(i => i.kind !== 'empty');
log.push(`Kiểm tra lịch sau sửa: ${iss.length} lỗi${iss.length ? ' — ' + iss.map(i => `${i.date} ${i.shift} ${i.message}`).join('; ') : ''}`);
log.push(`  ô trống còn lại: ${validateRoster(after).filter(i => i.kind === 'empty').length}`);

// 4. Diễn biến chép từ ca khác: mục "Nhận ca" mang giờ bắt đầu của ca khác (vd Ca 1 ghi "22:00 Nhận
//    ca") → dời TẤT CẢ mốc giờ của ca đó theo độ lệch (22:00→06:00, 22:30→06:30). Ca không có dấu hiệu
//    này giữ nguyên (mốc lệch nhẹ quanh giờ giao ca như 14:30 ở Ca 1 là hợp lệ).
const mins = (t?: string) => { const m = /^\s*(\d{1,2})\s*[:hH]\s*(\d{2})?\s*$/.exec(t || ''); return m ? +m[1] * 60 + +(m[2] || 0) : null; };
const START: Record<string, number> = { 'Ca 1': 360, 'Ca 2': 840, 'Ca 3': 1320 };
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
for (const l of logs) {
  const recv = (l.situations || []).find(s => /nhận ca/i.test(s.content || '') && mins(s.time) != null);
  const m0 = recv ? mins(recv.time)! : null;
  const other = m0 == null ? null : Object.entries(START).find(([s, st]) => s !== l.shift && st === m0)?.[0];
  if (!other) continue;
  const delta = START[l.shift] - START[other];
  let changed = false;
  const situations = (l.situations || []).map(s => {
    const m = mins(s.time);
    if (m == null) return s;
    changed = true;
    const nm = ((m + delta) % 1440 + 1440) % 1440;
    log.push(`4 ${l.startdate.slice(0, 10)} ${l.shift} (diễn biến chép từ ${other}): ${s.time} → ${fmt(nm)} · ${(s.content || '').slice(0, 40).replace(/\n/g, ' ')}`);
    return { ...s, time: fmt(nm) };
  });
  if (changed) {
    const ex = hUpdate.find(u => u.id === l.id);
    if (ex) ex.patch.situations = situations; else hUpdate.push({ id: l.id, patch: { situations }, before: l });
  }
}

log.forEach(x => console.log(x));
console.log(`\nLịch tháng: sửa ${rUpdate.length}, tạo ${rCreate.length} · Sổ trực: sửa ${hUpdate.length}`);
if (iss.length) { console.error('CÒN LỖI LỊCH — xem trên (lỗi cũ 06/07 điều độ là đã biết).'); }
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

fs.writeFileSync(join(OUT, `backup_${Date.now()}.json`), JSON.stringify({ roster: rUpdate.map(u => u.before), handovers: hUpdate.map(u => u.before) }, null, 1));
for (const u of rUpdate) await api(`/api/collections/shift_roster/records/${u.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(u.patch) });
for (const c of rCreate) await api('/api/collections/shift_roster/records', { method: 'POST', headers: H, body: JSON.stringify(c) });
for (const u of hUpdate) await api(`/api/collections/handovers/records/${u.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(u.patch) });
console.log('Đã ghi.');
void daysOfMonth;
