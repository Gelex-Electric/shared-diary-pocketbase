/**
 * (chạy tay, một lần) SUY NHU CẦU VẬT TƯ cho điểm đo DỰ KIẾN có từ trước luồng
 * cấp vật tư (plan `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md` mục 8; user
 * đồng ý 26/10/2026, chạy thử trước).
 *
 * Vì sao: `dm_point.need` mới có từ schema v23. Điểm đo dự kiến cũ đều trống ⇒
 * hiện hàng loạt ở "Chưa khai nhu cầu" của Kinh Doanh ngay ngày đầu, dù vật tư
 * đã được phân bổ sẵn.
 *
 * Luật: điểm đo CHƯA TỪNG treo công tơ, `need` trống, CÓ vật tư đang phân bổ
 * (lần lắp chưa ngày tháo) ⇒ `need` = đúng vật tư đang phân bổ, gom theo quy
 * cách (loại + tỷ số TI/TU + hình dạng TI — lấy từ `dm_device`, không có thì từ
 * dòng lắp). Tức là coi như ĐỦ — đúng hiện trạng. Điểm đo không có vật tư nào
 * thì để nguyên (đó mới thật là việc của Kinh Doanh).
 *
 * `--empty` (user yêu cầu 26/10/2026): điểm đo dự kiến CHƯA CÓ vật tư nào ⇒ ghi
 * BỘ NHU CẦU CHUẨN theo HSN — cùng luật nút "Điền theo HSN" (`defaultNeed` trong
 * `src/lib/dm/supply.ts`): HSN 1 ⇒ công tơ TRỰC TIẾP + GP-03 + SIM; HSN > 1 ⇒
 * 3 TI tròn (tỷ số HSN×5/5 nếu hạ áp) + công tơ GIÁN TIẾP + GP-03 + SIM. Chưa có
 * HSN ⇒ để Kinh Doanh khai (không đoán). Không có cờ thì chỉ xử lý điểm đo đã có vật tư.
 *
 * Mặc định DRY-RUN. `--commit` mới ghi. Ghi tuần tự, lỗi thì dừng và báo đã ghi tới đâu.
 *   railway run -- node scripts/dm_backfill_need.mjs [--commit]
 * `--fill` (user chốt 27/10/2026): điểm đo ĐÃ CÓ nhu cầu nhưng thiếu so với BỘ CHUẨN
 * theo HSN ⇒ BÙ dòng còn thiếu (3 TI nếu HSN > 1, công tơ, GP-03, SIM), dòng đã có
 * giữ nguyên số lượng. Dòng công tơ ghi loại ngược với HSN hiện tại (vd HSN đổi 1 → 500)
 * thì sửa loại theo HSN. Lý do: 34 điểm đo ghi nhu cầu = vật tư đang gắn sẵn (26/10)
 * nên quy cách chưa gắn (vd TI của 8 điểm đo SINTEC) không có trong nhu cầu.
 *
 * PC có proxy SSL: đọc tự chuyển sang curl nhưng lệnh PATCH dùng `fetch` ⇒ thêm
 * `NODE_EXTRA_CA_CERTS=%TEMP%\corp-ca.pem` (đã chạy thật 26/10/2026: 34/34 điểm đo).
 */
import { pbLogin, allOf, PB_URL, ymd } from './lib/pb_meters.mjs';

const COMMIT = process.argv.includes('--commit');
const EMPTY = process.argv.includes('--empty');
const FILL = process.argv.includes('--fill');

/** Bộ nhu cầu chuẩn — CHÉP luật `defaultNeed` (supply.ts); sửa luật thì sửa cả hai. */
function defaultNeed(p) {
  const hsn = Number(p.hsn);
  if (!(hsn > 0)) return null;
  const conn = hsn === 1 ? 'truc_tiep' : 'gian_tiep';
  const base = [
    { type: 'CONGTO', meter_kind: conn, qty: 1 },
    { type: 'GP03', qty: 1 },
    { type: 'SIM', qty: 1 },
  ];
  if (conn === 'truc_tiep') return base;
  const ti = { type: 'TI', shape: 'tron', qty: 3 };
  if (p.voltage_level !== 'MV') { ti.ratio_primary = Math.round(hsn * 5 * 1000) / 1000; ti.ratio_secondary = 5; }
  return [ti, ...base];
}
const token = await pbLogin();
const [devices, assets, points] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point'].map(c => allOf(c, token)));

const byId = new Map(devices.map(d => [d.id, d]));
const bySerial = new Map(devices.map(d => [String(d.serial).trim(), d]));
const HAS_RATIO = ['TI', 'TU'];
const ORDER = ['TI', 'TU', 'CONGTO', 'GP03', 'SIM', 'KHAC'];

const textOf = need => need.map(n => `${n.qty}×${n.type}${n.ratio_primary ? ` ${n.ratio_primary}/${n.ratio_secondary ?? ''}` : ''}`
  + `${n.shape ? ` ${n.shape}` : ''}${n.meter_kind ? ` ${n.meter_kind}` : ''}`).join(', ');
const plan = [];
let skipHung = 0, skipHasNeed = 0, skipEmpty = 0, noHsn = [];

for (const p of points) {
  const mine = assets.filter(a => a.point === p.id);
  if (mine.some(a => a.type === 'CONGTO' && ymd(a.date_on))) { skipHung++; continue; }
  if (Array.isArray(p.need) && p.need.length) {
    if (!FILL) { skipHasNeed++; continue; }
    const std = defaultNeed(p);
    if (!std) { noHsn.push(p.code ?? p.id); continue; }
    const conn = Number(p.hsn) === 1 ? 'truc_tiep' : 'gian_tiep';
    const next = p.need.map(n => ({ ...n }));
    const notes = [];
    for (const n of next) {
      if (n.type === 'CONGTO' && n.meter_kind && n.meter_kind !== conn) {
        notes.push(`công tơ ${n.meter_kind} → ${conn}`); n.meter_kind = conn;
      }
    }
    for (const want of std) {
      const have = next.filter(n => n.type === want.type).reduce((s, n) => s + (Number(n.qty) || 0), 0);
      if (have >= want.qty) continue;
      next.push({ ...want, qty: want.qty - have });
      notes.push(`+${want.qty - have} ${want.type}`);
    }
    if (!notes.length) { skipHasNeed++; continue; }
    next.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    plan.push([p.id, next, `${p.code ?? p.id} (HSN ${p.hsn}): ${notes.join(', ')} ⇒ ${textOf(next)}`]);
    continue;
  }
  const live = mine.filter(a => !ymd(a.date_off));
  if (!live.length) {
    if (!EMPTY) { skipEmpty++; continue; }
    const need = defaultNeed(p);
    if (!need) { noHsn.push(p.code ?? p.id); continue; }
    plan.push([p.id, need, `${p.code ?? p.id} (HSN ${p.hsn}, chưa có vật tư): ${textOf(need)}`]);
    continue;
  }

  const groups = new Map();
  for (const a of live) {
    const d = (a.device && byId.get(a.device)) || bySerial.get(String(a.serial ?? '').trim());
    const type = d?.type ?? a.type;
    const line = { type };
    if (HAS_RATIO.includes(type)) {
      const rp = d?.ratio_primary ?? a.ratio_primary, rs = d?.ratio_secondary ?? a.ratio_secondary;
      if (rp > 0) { line.ratio_primary = rp; if (rs > 0) line.ratio_secondary = rs; }
    }
    if (type === 'TI' && d?.shape) line.shape = d.shape;
    const key = JSON.stringify(line);
    groups.set(key, { ...line, qty: (groups.get(key)?.qty ?? 0) + 1 });
  }
  const need = [...groups.values()].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  plan.push([p.id, need, `${p.code ?? p.id}: ${textOf(need)}`]);
}

console.log(`\nPB: ${PB_URL}`);
console.log(`Điểm đo: ${points.length} · đã từng treo (bỏ qua) ${skipHung} · đã có nhu cầu ${skipHasNeed} · `
  + `chưa có vật tư nào (để Kinh Doanh khai) ${skipEmpty}`);
if (noHsn.length) console.log(`Chưa có HSN — để Kinh Doanh khai (${noHsn.length}): ${noHsn.join(', ')}`);
console.log(`SẼ GHI nhu cầu cho ${plan.length} điểm đo dự kiến:`);
for (const [, , why] of plan) console.log(`  · ${why}`);

if (!COMMIT) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --commit để ghi thật.');
  process.exit(0);
}
let n = 0;
for (const [id, need, why] of plan) {
  const r = await fetch(`${PB_URL}/api/collections/dm_point/records/${id}`, {
    method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ need }),
  });
  if (!r.ok) {
    console.error(`\nDỪNG sau ${n}/${plan.length}: ${why} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  n++;
}
console.log(`\nXong ${n}/${plan.length}. Chạy lại không --commit để kiểm tra (phải còn 0).`);
