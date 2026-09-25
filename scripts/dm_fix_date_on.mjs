#!/usr/bin/env node
/**
 * Sửa NGÀY TREO (`dm_asset.date_on`) của công tơ đang treo theo dữ liệu HES.
 *
 * Luật (user chốt 24/09/2026): công tơ ĐÃ CÓ dữ liệu trên HES mà Danh mục chưa có
 * ngày treo, hoặc ngày treo muộn hơn ngày dữ liệu xuất hiện ⇒ ngày treo = NGÀY
 * ĐẦU TIÊN XUẤT HIỆN DỮ LIỆU.
 *
 * Chỉ xét lần treo HIỆN TẠI (có `point`, chưa `date_off`). Không lùi quá ngày tháo
 * của lần treo TRƯỚC của cùng công tơ — số trước đó thuộc lần treo cũ.
 *
 * Dò ngược theo từng tháng từ mốc bắt đầu, dừng ở tháng đầu tiên KHÔNG có số (dữ liệu
 * một lần treo là liền mạch); nên công tơ không có số trước ngày treo chỉ tốn 1 lời gọi.
 *
 * Mặc định CHỈ IN. `--apply` mới ghi PB (dữ liệu thật — staging dùng chung PB).
 * Bản ghi cũ lưu ra `--backup <file>` trước khi ghi.
 *
 *   node scripts/dm_fix_date_on.mjs                      # xem
 *   node scripts/dm_fix_date_on.mjs --apply --backup x.json
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, allOf, PB_URL } from './lib/pb_meters.mjs';

const APPLY = process.argv.includes('--apply');
const bi = process.argv.indexOf('--backup');
const BACKUP = bi > 0 ? process.argv[bi + 1] : '';
/** Không dò xa hơn mốc này (Danh mục cũ nhất ~02/2024). */
const FLOOR = process.env.FLOOR || '2024-01-01';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => ymd(new Date(parse(s).getTime() + n * 86400000));
const day10 = (v) => String(v ?? '').slice(0, 10);

const token = await getToken();
/** Các ngày có số trong [from, to] (cả hai đầu). */
async function daysWithData(serial, from, to) {
  if (from > to) return [];
  const end = parse(to); end.setHours(23, 59, 59, 0);
  const d = await getJson('GetMeterDataByDate',
    { MeterNo: serial, StartDate: stamp(parse(from)), EndDate: stamp(end), Token: token });
  if (!Array.isArray(d)) {
    if (String(d?.MESSAGE ?? '').toLowerCase() === 'invalid token') throw new Error('invalid token');
    return [];
  }
  /* MỌI bản ghi, kể cả chỉ số 0: công tơ mới treo có điện áp nhưng chưa có tải vẫn là
     "đã xuất hiện dữ liệu" (gặp 2610322995: có điện từ 18/08, chỉ số 0 tới hết tháng). */
  return [...new Set(d.filter(r => r.DATE_TIME || r.DATA_TIME)
    .map(r => day10(r.DATE_TIME || r.DATA_TIME)))].filter(x => x >= from && x <= to).sort();
}

/** Ngày đầu tiên có số, dò ngược từng tháng từ `start` (không gồm) về `floor`. */
async function firstDay(serial, start, floor) {
  let first = null;
  let hi = addDays(start, -1);
  while (hi >= floor) {
    const lo = [addDays(hi, -30), floor].sort().pop();
    const days = await daysWithData(serial, lo, hi);
    if (!days.length) break;
    first = days[0];
    /* Tháng này có số nhưng không kín tới đầu tháng ⇒ đã gặp chỗ bắt đầu. */
    if (days[0] > lo) break;
    hi = addDays(lo, -1);
  }
  return first;
}

const pb = await pbLogin();
const assets = (await allOf('dm_asset', pb)).filter(a => a.type === 'CONGTO' && a.serial);
const today = ymd(new Date());
const current = assets.filter(a => a.point && !day10(a.date_off));
console.log(`Xét ${current.length} lần treo hiện tại`);

const res = await mapLimit(current, 6, async (a) => {
  const sn = String(a.serial).trim();
  /* Không lùi quá ngày tháo của lần treo TRƯỚC của chính công tơ này. */
  const prevOff = assets.filter(x => String(x.serial).trim() === sn && x.id !== a.id && day10(x.date_off))
    .map(x => day10(x.date_off)).sort().pop();
  const floor = prevOff ? addDays(prevOff, 1) : FLOOR;
  const on = day10(a.date_on);
  let first = await firstDay(sn, on || addDays(today, 1), floor);
  /* Dữ liệu có thể đứt một tháng giữa chừng (gặp 2510203106: đứt rồi có lại) ⇒
     dò tiếp từ ngày vừa tìm được tới khi không lùi thêm được nữa. */
  for (let more = first; more; ) {
    more = await firstDay(sn, first, floor);
    if (more && more < first) first = more; else more = null;
  }
  if (!first) return { a, sn, on, first: null, act: on ? 'OK' : 'KHONG_CO_SO' };
  if (!on) return { a, sn, on, first, act: 'THEM', floor };
  return { a, sn, on, first, act: first < on ? 'LUI' : 'OK', floor };
});
if (res.some(r => /invalid token/.test(r?.error ?? ''))) { console.error('Token HES hỏng — dừng.'); process.exit(1); }
const errs = res.filter(r => r?.error);
if (errs.length) console.log(`[WARN] ${errs.length} lỗi: ${errs[0].error}`);

const fix = res.filter(r => r?.act === 'THEM' || r?.act === 'LUI');
const none = res.filter(r => r?.act === 'KHONG_CO_SO');
console.log(`\nCần sửa ${fix.length}:`);
for (const r of fix) {
  console.log(`  ${r.sn}  ${r.act === 'THEM' ? 'chưa có' : r.on} → ${r.first}`
    + `${r.floor !== FLOOR ? `  (không lùi quá ${r.floor})` : ''}`);
}
console.log(`\nThiếu ngày treo nhưng HES KHÔNG có số (để nguyên): ${none.map(r => r.sn).join(', ') || '—'}`);

if (!APPLY) { console.log('\n(chỉ xem — thêm --apply --backup <file> để ghi)'); process.exit(0); }
if (!BACKUP) { console.error('--apply cần --backup <file>.'); process.exit(1); }
writeFileSync(BACKUP, JSON.stringify(fix.map(r => ({ id: r.a.id, serial: r.sn, date_on_cu: r.a.date_on, date_on_moi: r.first })), null, 1));
console.log(`\nĐã lưu bản cũ → ${BACKUP}`);

/* PATCH qua curl: fetch của Node hỏng cert ở mạng công ty. */
let ok = 0;
for (const r of fix) {
  const out = execFileSync('curl', ['-s', '-m', '60', '-X', 'PATCH',
    `${PB_URL}/api/collections/dm_asset/records/${r.a.id}`,
    '-H', `Authorization: ${pb}`, '-H', 'Content-Type: application/json',
    '--data-binary', JSON.stringify({ date_on: `${r.first} 00:00:00.000Z` }), '-w', '\n%{http_code}'],
  { encoding: 'utf8' });
  const code = out.slice(out.lastIndexOf('\n') + 1);
  if (code === '200') ok++; else console.log(`  [LỖI] ${r.sn}: HTTP ${code} ${out.slice(0, 150)}`);
}
console.log(`Đã ghi ${ok}/${fix.length}.`);
