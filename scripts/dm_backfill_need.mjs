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
 * Mặc định DRY-RUN. `--commit` mới ghi. Ghi tuần tự, lỗi thì dừng và báo đã ghi tới đâu.
 *   railway run -- node scripts/dm_backfill_need.mjs [--commit]
 * PC có proxy SSL: đọc tự chuyển sang curl nhưng lệnh PATCH dùng `fetch` ⇒ thêm
 * `NODE_EXTRA_CA_CERTS=%TEMP%\corp-ca.pem` (đã chạy thật 26/10/2026: 34/34 điểm đo).
 */
import { pbLogin, allOf, PB_URL, ymd } from './lib/pb_meters.mjs';

const COMMIT = process.argv.includes('--commit');
const token = await pbLogin();
const [devices, assets, points] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point'].map(c => allOf(c, token)));

const byId = new Map(devices.map(d => [d.id, d]));
const bySerial = new Map(devices.map(d => [String(d.serial).trim(), d]));
const HAS_RATIO = ['TI', 'TU'];
const ORDER = ['TI', 'TU', 'CONGTO', 'GP03', 'SIM', 'KHAC'];

const plan = [];
let skipHung = 0, skipHasNeed = 0, skipEmpty = 0;

for (const p of points) {
  const mine = assets.filter(a => a.point === p.id);
  if (mine.some(a => a.type === 'CONGTO' && ymd(a.date_on))) { skipHung++; continue; }
  if (Array.isArray(p.need) && p.need.length) { skipHasNeed++; continue; }
  const live = mine.filter(a => !ymd(a.date_off));
  if (!live.length) { skipEmpty++; continue; }

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
  const text = need.map(n => `${n.qty}×${n.type}${n.ratio_primary ? ` ${n.ratio_primary}/${n.ratio_secondary ?? ''}` : ''}${n.shape ? ` ${n.shape}` : ''}`).join(', ');
  plan.push([p.id, need, `${p.code ?? p.id}: ${text}`]);
}

console.log(`\nPB: ${PB_URL}`);
console.log(`Điểm đo: ${points.length} · đã từng treo (bỏ qua) ${skipHung} · đã có nhu cầu ${skipHasNeed} · `
  + `chưa có vật tư nào (để Kinh Doanh khai) ${skipEmpty}`);
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
