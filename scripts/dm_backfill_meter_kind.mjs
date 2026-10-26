/**
 * (chạy tay, một lần) Gán LOẠI CÔNG TƠ (trực tiếp / gián tiếp — schema v24) cho
 * công tơ trong kho đang để trống `meter_kind`, SUY từ điểm đo nó đã/đang lắp:
 *
 *   điểm đo HSN = 1 (đo thẳng, không TI)  ⇒ truc_tiep
 *   điểm đo HSN > 1 (qua TI)              ⇒ gian_tiep
 *   HSN điểm đo trống ⇒ theo `connection` của điểm đo.
 *
 * Lấy theo lần lắp MỚI NHẤT (đang treo / dự kiến trước, rồi ngày treo gần nhất).
 * Công tơ chưa từng lắp ⇒ để trống, Nhóm Vật Tư khai tay. Công tơ từng lắp ở cả
 * hai kiểu điểm đo ⇒ vẫn theo lần mới nhất, nhưng in ra để soát.
 *
 * Mặc định DRY-RUN. `--commit` mới ghi.
 *   railway run -- node scripts/dm_backfill_meter_kind.mjs [--commit]
 * PC có proxy SSL: thêm `NODE_EXTRA_CA_CERTS=%TEMP%\corp-ca.pem` (lệnh PATCH dùng `fetch`).
 */
import { pbLogin, allOf, PB_URL, ymd } from './lib/pb_meters.mjs';

const COMMIT = process.argv.includes('--commit');
const token = await pbLogin();
const [devices, assets, points] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point'].map(c => allOf(c, token)));
const pointById = new Map(points.map(p => [p.id, p]));

const kindOf = (p) => {
  if (!p) return '';
  if (p.hsn != null && Number(p.hsn) > 0) return Number(p.hsn) === 1 ? 'truc_tiep' : 'gian_tiep';
  return p.connection || '';
};

const meters = devices.filter(d => d.type === 'CONGTO');
const blank = meters.filter(d => !d.meter_kind);
const plan = [];
const never = [];
const mixed = [];
for (const d of blank) {
  const mine = assets.filter(a => a.point && (a.device === d.id || (!a.device && String(a.serial).trim() === String(d.serial).trim())));
  if (!mine.length) { never.push(d); continue; }
  // Đang mở (chưa ngày tháo) trước, rồi ngày treo mới nhất.
  const latest = [...mine].sort((a, b) =>
    Number(!ymd(b.date_off)) - Number(!ymd(a.date_off))
    || ymd(b.date_on).localeCompare(ymd(a.date_on)))[0];
  const kind = kindOf(pointById.get(latest.point));
  if (!kind) { never.push(d); continue; }
  const kinds = new Set(mine.map(a => kindOf(pointById.get(a.point))).filter(Boolean));
  if (kinds.size > 1) mixed.push(`${d.serial}: từng lắp cả hai kiểu, lấy ${kind} theo ${pointById.get(latest.point)?.code}`);
  plan.push([d, kind]);
}

const n = k => plan.filter(([, x]) => x === k).length;
console.log(`\nPB: ${PB_URL}`);
console.log(`Công tơ: ${meters.length} · đã có loại ${meters.length - blank.length} · trống ${blank.length}`);
console.log(`SẼ GÁN: trực tiếp ${n('truc_tiep')} · gián tiếp ${n('gian_tiep')} · để trống (chưa từng lắp / điểm đo không rõ) ${never.length}`);
if (mixed.length) { console.log(`Từng lắp cả hai kiểu (${mixed.length}):`); mixed.forEach(m => console.log(`  · ${m}`)); }
if (never.length) console.log(`Để trống: ${never.map(d => d.serial).join(', ')}`);

if (!COMMIT) { console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --commit để ghi thật.'); process.exit(0); }
let done = 0;
for (const [d, kind] of plan) {
  const r = await fetch(`${PB_URL}/api/collections/dm_device/records/${d.id}`, {
    method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ meter_kind: kind }),
  });
  if (!r.ok) {
    console.error(`\nDỪNG sau ${done}/${plan.length}: ${d.serial} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  done++;
}
console.log(`\nXong ${done}/${plan.length}.`);
