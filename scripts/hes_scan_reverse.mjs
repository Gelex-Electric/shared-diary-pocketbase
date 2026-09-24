/**
 * Quét PHÁT NGƯỢC / DƯ BÙ cho mọi công tơ ĐANG TREO trong một khoảng ngày — CHỈ ĐỌC.
 *
 *   node scripts/hes_scan_reverse.mjs --from 2026-09-01 --to 2026-09-23
 *   node scripts/hes_scan_reverse.mjs --date 2026-09-18
 *
 * Không ghi file. Mặc định KHÔNG ghi PocketBase; `--notify` (chỉ với --date) mới ghi
 * một cảnh báo `phatnguoc` gộp cho ngày đó. Mỗi công tơ MỘT lời gọi `GetMeterDataByDate`
 * cho cả khoảng; bản ghi được chia theo ngày của MỐC ĐẦU mỗi khoảng nửa giờ (khoảng
 * 23:30 → 00:00 thuộc ngày trước), nên cộng các ngày lại vẫn đúng tổng khoảng.
 *
 * Cần: PB_EMAIL/PB_PASS (đọc danh mục), API_TOKEN hoặc API_USER/API_PASS.
 */
import { getJson, getToken, mapLimit, stamp } from './lib/hes_api.mjs';
import { pbLogin, liveMeters } from './lib/pb_meters.mjs';
import { detectReverse, peakNote, buildReverseAlert } from './lib/exportCheck.mjs';
import { raiseAlert, zoneOf } from './lib/pb_alert.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const one = arg('--date');
const from = one || arg('--from');
const to = one || arg('--to');
if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) {
  console.error('Dùng: --date YYYY-MM-DD hoặc --from YYYY-MM-DD --to YYYY-MM-DD'); process.exit(1);
}
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
/* Dư bù đo theo TỶ LỆ với vô công giao (xem DUBU_RATIO) — `--only-phatnguoc` để bỏ qua. */
const KINDS = process.argv.includes('--only-phatnguoc') ? ['phatnguoc'] : ['phatnguoc', 'dubu'];
const recTime = (r) => r?.DATE_TIME || r?.DATA_TIME || '';

const NOTIFY = process.argv.includes('--notify');
if (NOTIFY && !one) { console.error('--notify chỉ dùng với --date (một ngày).'); process.exit(1); }
const pbToken = await pbLogin();
const { meters, customers } = await liveMeters(pbToken);
const byMkh = new Map(customers.map(c => [c.mkh, c]));
const shortNameOf = (mkh) => byMkh.get(mkh)?.short_name || byMkh.get(mkh)?.name || '';
const token = await getToken();
const start = parse(from);
/* lấy thêm mốc 00:00 hôm sau để khoảng 23:30 của ngày cuối được trọn */
const end = new Date(parse(to).getTime() + 86400000);
console.log(`Quét ${from} → ${to}: ${meters.length} công tơ đang treo ${NOTIFY ? '(GHI cảnh báo)' : '(chỉ đọc)'}\n`);

let apiErr = 0, empty = 0;
const hits = await mapLimit(meters, Number(process.env.CONCURRENCY || 6), async (m) => {
  let data;
  try {
    data = await getJson('GetMeterDataByDate', { MeterNo: m.serial, StartDate: stamp(start), EndDate: stamp(end), Token: token });
  } catch { apiErr++; return []; }
  if (!Array.isArray(data)) {
    if (String(data?.MESSAGE ?? '').toLowerCase() === 'invalid token') throw new Error('invalid token');
    empty++; return [];
  }
  if (!data.length) { empty++; return []; }
  const recs = data.filter(r => recTime(r)).sort((a, b) => recTime(a).localeCompare(recTime(b)));
  const out = [];
  for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86400000)) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const i0 = recs.findIndex(r => recTime(r).slice(0, 10) === day);
    if (i0 < 0) continue;
    let i1 = i0; while (i1 + 1 < recs.length && recTime(recs[i1 + 1]).slice(0, 10) === day) i1++;
    const res = detectReverse(recs.slice(i0, i1 + 2), m.hsn);   // +1 mốc đầu hôm sau
    for (const kind of KINDS) if (res[kind]) out.push({ m, day, kind, r: res[kind] });
  }
  return out;
});
/* mapLimit nuốt lỗi thành {error} — token hỏng mà không dừng thì in ra "0 công tơ" y như sạch. */
const broken = hits.filter(h => h?.error);
if (broken.some(h => /invalid token/.test(h.error))) { console.error('Token HES hỏng — dừng.'); process.exit(1); }
if (broken.length) console.log(`[WARN] ${broken.length} công tơ lỗi: ${broken[0].error}`);
const all = hits.filter(Array.isArray).flat();

const fmt = (x) => x.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
for (const kind of KINDS) {
  const list = all.filter(h => h.kind === kind);
  const bySerial = new Map();
  for (const h of list) (bySerial.get(h.m.serial) ?? bySerial.set(h.m.serial, []).get(h.m.serial)).push(h);
  console.log(`=== ${kind === 'phatnguoc' ? 'PHÁT NGƯỢC (Hữu công nhận)' : 'DƯ BÙ (Vô công nhận)'}: `
    + `${bySerial.size} công tơ, ${list.length} ngày-công tơ ===`);
  const rows = [...bySerial.values()].map(hs => ({ hs, tot: hs.reduce((s, h) => s + h.r.value, 0) }))
    .sort((a, b) => b.tot - a.tot);
  for (const { hs, tot } of rows) {
    const m = hs[0].m;
    const minRaw = Math.min(...hs.map(h => h.r.raw));
    console.log(`\n${m.serial}  ${m.code}  HSN ${m.hsn}  — ${hs.length} ngày, tổng ${fmt(tot)} ${hs[0].r.unit}`
      + `, bước thô nhỏ nhất ${minRaw}`);
    for (const h of hs) {
      console.log(`   ${h.day}  ${fmt(h.r.value).padStart(9)} ${h.r.unit}  thô ${h.r.fromIndex}→${h.r.toIndex}`
        + `  ${h.r.fromTime.slice(11, 16)}→${h.r.toTime.slice(11, 16)}  ${peakNote(h.r)}`);
    }
  }
  console.log('');
}
console.log(`Lỗi API: ${apiErr} công tơ · không có bản ghi: ${empty} công tơ`);

if (NOTIFY) {
  for (const kind of KINDS) {
    const a = buildReverseAlert(one, all.filter(h => h.kind === kind && h.day === one), shortNameOf, zoneOf, kind);
    if (!a) console.log(`${kind}: không có công tơ nào — không ghi gì.`);
    else console.log(`Cảnh báo ${kind} ${one}: ${await raiseAlert(pbToken, a) ? 'ĐÃ GHI 1 bản' : 'bỏ qua (đã có bản cho ngày này)'}`);
  }
}
