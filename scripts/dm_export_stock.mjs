#!/usr/bin/env node
/**
 * Xuất Excel VẬT TƯ CHƯA LẮP tính tới thời điểm chạy.
 *
 * "Chưa lắp" = không còn lần lắp nào đang mở, và chưa thanh lý. Gồm cả ba loại:
 *   - chưa từng ra hiện trường, chưa dành cho ai;
 *   - đã DÀNH SẴN cho một điểm đo dự kiến (khai rồi nhưng chưa treo);
 *   - từng lắp, đã tháo, nay nằm kho chờ tái sử dụng.
 *
 * Trạng thái suy bằng `deriveDeviceStatus` của app, không đọc cột lưu sẵn —
 * cột `status` đã bị bỏ ở schema v14 chính vì nó lệch được.
 *
 * CHỈ ĐỌC PocketBase. Ghi ra một file .xlsx.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_export_stock.mjs [đường-dẫn-ra.xlsx]
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = process.argv.find(a => a.endsWith('.xlsx'))
  || join(ROOT, '..', `Vat-tu-chua-lap-${TODAY}.xlsx`);
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/* Dùng ĐÚNG logic của app để suy trạng thái và số ngày nằm kho. */
const tmp = mkdtempSync(join(tmpdir(), 'dm-'));
const out = join(tmp, 'stock.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/dm/stock.ts')], outfile: out,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { buildStock, idleDays, IDLE_WARN_DAYS } = await import(pathToFileURL(out).href);
rmSync(tmp, { recursive: true, force: true });

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

/** Lấy HẾT bản ghi — `dm_asset` đã vượt 500, một trang là thiếu im lặng. */
const allOf = async (col) => {
  const o = [];
  for (let p = 1; ; p++) {
    const r = await (await fetch(
      `${PB}/api/collections/${col}/records?perPage=500&page=${p}`, { headers: H })).json();
    o.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return o;
  }
};
const [zones, customers, stations, points, assets, devices] = await Promise.all(
  ['dm_zone', 'dm_customer', 'dm_station', 'dm_point', 'dm_asset', 'dm_device'].map(allOf));

const zoneById = Object.fromEntries(zones.map(z => [z.id, z]));
const cusById = Object.fromEntries(customers.map(c => [c.id, c]));
const stById = Object.fromEntries(stations.map(s => [s.id, s]));
const zoneOfPoint = (p) => (p ? stById[p.station]?.zone : undefined);

const rows = buildStock(devices, assets, points, zoneOfPoint)
  .filter(r => r.status === 'kho');

const TYPE_VN = {
  CONGTO: 'Công tơ', GP03: 'Đo xa GP-03', TI: 'TI (biến dòng)',
  TU: 'TU (biến điện áp)', SIM: 'SIM', KHAC: 'Khác',
};
const dmy = (s) => {
  const v = String(s ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '';
};

/** Ba nhóm, gọi tên đúng như trên giao diện để đọc xong hiểu ngay. */
const groupOf = (r) => r.holdingPoint ? 'Dành sẵn cho điểm đo dự kiến'
  : r.installCount > 0 ? 'Đã tháo, chưa dùng lại'
    : 'Chưa từng lắp';

/*
  VỊ TRÍ VẬT TƯ — vật tư tháo xuống nằm ở kho của chính KCN đó, không gom về
  một chỗ. Suy từ ĐOẠN ĐẦU của mã: `TH.BQL.T1...` → TH → KCN Tiền Hải.

  Mã trạm ghép theo `<hậu tố KCN>.<tên tắt KH>...` (xem `naming.ts`), nên đoạn
  trước dấu chấm đầu tiên chính là hậu tố KCN — ghép `KCN` vào là ra mã KCN
  trong danh mục, không cần bảng tra tay.
*/
const zoneByCode = Object.fromEntries(zones.map(z => [String(z.code).toUpperCase(), z]));
const OFFICE = 'Văn phòng GETC';

const prefixOf = (code) => String(code ?? '').split('.')[0].trim().toUpperCase();

const placeOfCode = (code) => {
  const p = prefixOf(code);
  if (!p) return '';
  // Kho của công ty, không thuộc KCN nào.
  if (/^GETC/.test(p)) return OFFICE;
  const z = zoneByCode[`KCN${p}`];
  /*
    Đầu mã KHÔNG khớp KCN nào thì TRẢ RỖNG, không lấy nguyên chuỗi làm vị trí.

    `hold_for_note` là ô gõ tự do, có dòng ghi cả câu ("Đã thay thế bằng công
    tơ 2510317505"). Lấy bừa đoạn đầu sẽ đẻ ra một "vị trí" là nguyên câu đó.
    Trả rỗng thì nó rơi xuống các phương án sau, cùng lắm là "Chưa rõ" — đúng
    hơn là bịa một cái kho không tồn tại.
  */
  return z ? `${z.name} (${p})` : '';
};

/**
 * Vị trí hiện tại, theo thứ tự tin cậy giảm dần:
 *   1. nơi lắp GẦN NHẤT — tháo ra thì vật tư nằm lại kho KCN đó;
 *   2. điểm đo đang giữ chỗ — hàng đã chuyển tới nơi chờ lắp;
 *   3. ghi chú "dành cho" — chỗ duy nhất biết được với hàng chưa từng lắp
 *      (`PĐ.DỰ PHÒNG`, `GETC`, `TH.THU HỒI`…);
 *   4. KCN dự định.
 */
const placeOf = (r) => placeOfCode(r.installs.at(-1)?.point?.code)
  || placeOfCode(r.holdingPoint?.code)
  || placeOfCode(r.device.hold_for_note)
  || (r.zoneId && zoneById[r.zoneId]
    ? `${zoneById[r.zoneId].name} (${String(zoneById[r.zoneId].code).replace(/^KCN/, '')})`
    : '')
  || 'Chưa rõ';

const sheet = rows
  .map(r => {
    const d = r.device;
    const zone = zoneById[r.zoneId ?? ''];
    const idle = idleDays(r, TODAY);
    return {
      'Số No': String(d.serial),
      'Loại': TYPE_VN[d.type] ?? d.type,
      'Tỷ số': d.ratio_primary != null ? `${d.ratio_primary}/${d.ratio_secondary ?? ''}` : '',
      'Nhóm': groupOf(r),
      'Vị trí hiện tại': placeOf(r),
      'Dành cho điểm đo': r.holdingPoint?.code ?? '',
      'Dành cho khách hàng': cusById[d.hold_for_customer ?? '']?.mkh ?? '',
      'Dành cho (ghi chú)': d.hold_for_note ?? '',
      'KCN': zone ? `${zone.name} (${zone.code})` : '',
      'Lô nhập': d.batch ?? '',
      'Ngày nhập kho': dmy(d.date_in),
      'Số lần đã lắp': r.installCount,
      'Nơi lắp gần nhất': r.installs.at(-1)?.point?.code ?? '',
      'Ngày tháo gần nhất': dmy(r.lastOff),
      'Số ngày nằm kho': idle || '',
      'Quá hạn': idle > IDLE_WARN_DAYS ? `x (>${IDLE_WARN_DAYS} ngày)` : '',
      'Model': d.model_desc ?? '',
      'Ghi chú': d.note ?? '',
    };
  })
  // Xếp theo nhóm rồi loại rồi số No — đọc theo cụm, không phải dò từng dòng.
  // Xếp theo VỊ TRÍ trước — đi kiểm kho nào thì đọc gọn một cụm.
  .sort((a, b) => a['Vị trí hiện tại'].localeCompare(b['Vị trí hiện tại'], 'vi')
    || a['Nhóm'].localeCompare(b['Nhóm'], 'vi')
    || a['Loại'].localeCompare(b['Loại'], 'vi')
    || a['Số No'].localeCompare(b['Số No'], 'vi', { numeric: true }));

/* --------------------------- Sheet tổng hợp --------------------------- */
const pivot = new Map();
for (const r of sheet) {
  const key = `${r['Nhóm']}|${r['Loại']}`;
  pivot.set(key, (pivot.get(key) ?? 0) + 1);
}
const summary = [...pivot.entries()]
  .map(([k, n]) => ({ 'Nhóm': k.split('|')[0], 'Loại': k.split('|')[1], 'Số lượng': n }))
  .sort((a, b) => a['Nhóm'].localeCompare(b['Nhóm'], 'vi') || b['Số lượng'] - a['Số lượng']);
summary.push({ 'Nhóm': 'TỔNG CỘNG', 'Loại': '', 'Số lượng': sheet.length });

/* Tổng hợp theo VỊ TRÍ × LOẠI — dùng thẳng khi đi kiểm kho từng nơi. */
const byPlace = new Map();
for (const r of sheet) {
  const k = `${r['Vị trí hiện tại']}|${r['Loại']}`;
  byPlace.set(k, (byPlace.get(k) ?? 0) + 1);
}
const placeSheet = [...byPlace.entries()]
  .map(([k, n]) => ({ 'Vị trí': k.split('|')[0], 'Loại': k.split('|')[1], 'Số lượng': n }))
  .sort((a, b) => a['Vị trí'].localeCompare(b['Vị trí'], 'vi') || b['Số lượng'] - a['Số lượng']);
placeSheet.push({ 'Vị trí': 'TỔNG CỘNG', 'Loại': '', 'Số lượng': sheet.length });

/* ------------------------------- Ghi file ------------------------------- */
const wb = XLSX.utils.book_new();
const s1 = XLSX.utils.json_to_sheet(sheet);
// Cột số No phải là CHỮ, không thì Excel đổi số 15–20 chữ số sang dạng khoa học.
s1['!cols'] = [
  { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 30 }, { wch: 26 }, { wch: 30 },
  { wch: 14 }, { wch: 24 }, { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 13 },
  { wch: 28 }, { wch: 16 }, { wch: 15 }, { wch: 16 }, { wch: 16 }, { wch: 24 },
];
XLSX.utils.book_append_sheet(wb, s1, 'Vật tư chưa lắp');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Tổng hợp theo loại');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(placeSheet), 'Tổng hợp theo vị trí');
XLSX.writeFile(wb, OUT);

console.log(`Ngày chốt : ${dmy(TODAY)}`);
console.log(`Thiết bị trong PB : ${devices.length}`);
console.log(`CHƯA LẮP          : ${sheet.length}\n`);
for (const r of summary) console.log(`   ${String(r['Nhóm']).padEnd(32)} ${String(r['Loại']).padEnd(18)} ${r['Số lượng']}`);
console.log('\nTheo vị trí:');
const totalByPlace = new Map();
for (const r of sheet) totalByPlace.set(r['Vị trí hiện tại'], (totalByPlace.get(r['Vị trí hiện tại']) ?? 0) + 1);
for (const [k, v] of [...totalByPlace.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(k).padEnd(30)} ${v}`);
}
console.log(`\nĐã ghi: ${OUT}  (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
