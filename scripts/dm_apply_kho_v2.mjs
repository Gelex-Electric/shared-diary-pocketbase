/**
 * (chạy tay) Cập nhật HÌNH DẠNG TI và LOẠI CÔNG TƠ trong kho (`dm_device`) theo
 * file Excel cũ "Quản lý kho V2.xlsx" (user gửi 26/10/2026), chủ yếu bảng
 * XUATNHAP (sheet "Quản lý giao dịch") + sheet "Quản lý vật tư":
 *
 *   - TI có dòng ghi chú chứa "vuông"  ⇒ shape = vuong (còn lại giữ nguyên — mặc định tròn)
 *   - LOAIVT ME42 ⇒ công tơ TRỰC TIẾP · ME41 ⇒ GIÁN TIẾP (user chốt)
 *
 * File Excel là nguồn ưu tiên: khác với PB thì ghi theo file và in ra để soát.
 * Số ID có trong file mà không có trong kho PB chỉ in ra, không tạo mới.
 *
 * Mặc định DRY-RUN. `--commit` mới ghi.
 *   railway run -- node scripts/dm_apply_kho_v2.mjs "<đường dẫn Quản lý kho V2.xlsx>" [--commit]
 * PC có proxy SSL: thêm `NODE_EXTRA_CA_CERTS=%TEMP%\corp-ca.pem` (lệnh PATCH dùng `fetch`).
 */
import { createRequire } from 'node:module';
import { pbLogin, allOf, PB_URL } from './lib/pb_meters.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) { console.error('Thiếu đường dẫn file Quản lý kho V2.xlsx'); process.exit(1); }
const COMMIT = process.argv.includes('--commit');

/* ------------------------------ đọc Excel ------------------------------ */
const wb = XLSX.readFile(file, { cellDates: true });
const sheet = n => {
  if (!wb.Sheets[n]) { console.error(`File thiếu sheet "${n}"`); process.exit(1); }
  return XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' });
};
const tx = sheet('Quản lý giao dịch');       // bảng XUATNHAP
const vt = sheet('Quản lý vật tư');           // bảng VATTU
const norm = s => String(s ?? '').normalize('NFC').toLowerCase();
const id = s => String(s ?? '').trim();

const vuong = new Set();
for (const r of tx) {
  if (String(r.LOAIVT).toUpperCase() === 'TI' && Object.values(r).some(x => /vuông|vuong/.test(norm(x)))) vuong.add(id(r.ID));
}
for (const r of vt) {
  if (String(r['Loại vật tư']).toUpperCase() === 'TI' && Object.values(r).some(x => /vuông|vuong/.test(norm(x)))) vuong.add(id(r['Số ID']));
}

const kind = new Map();
const conflict = new Set();
const meterRows = [
  ...tx.map(r => [r.ID, r.LOAIVT]),
  ...vt.map(r => [r['Số ID'], r['Loại vật tư']]),
];
for (const [rawId, rawType] of meterRows) {
  const t = String(rawType).toUpperCase().replace(/[-\s]/g, '');
  if (t !== 'ME41' && t !== 'ME42') continue;
  const k = t === 'ME42' ? 'truc_tiep' : 'gian_tiep';
  if (kind.has(id(rawId)) && kind.get(id(rawId)) !== k) conflict.add(id(rawId));
  kind.set(id(rawId), k);
}

/* ------------------------------ đối chiếu PB ------------------------------ */
const token = await pbLogin();
const devices = await allOf('dm_device', token);
const bySerial = new Map(devices.map(d => [id(d.serial), d]));

const plan = [];
const missing = [];
const notTi = [];
for (const sn of vuong) {
  const d = bySerial.get(sn);
  if (!d) { missing.push(`TI vuông ${sn}`); continue; }
  if (d.type !== 'TI') { notTi.push(`${sn} (PB ghi ${d.type})`); continue; }
  if (d.shape !== 'vuong') plan.push([d, { shape: 'vuong' }, `TI ${sn}: ${d.shape || 'trống'} → vuông`]);
}
let sameKind = 0;
for (const [sn, k] of kind) {
  if (conflict.has(sn)) continue;
  const d = bySerial.get(sn);
  if (!d) { missing.push(`công tơ ${sn}`); continue; }
  if (d.type !== 'CONGTO') { notTi.push(`${sn} (file ghi công tơ, PB ghi ${d.type})`); continue; }
  if (d.meter_kind === k) { sameKind++; continue; }
  plan.push([d, { meter_kind: k }, `Công tơ ${sn}: ${d.meter_kind || 'trống'} → ${k}`]);
}
const pbMetersNotInFile = devices.filter(d => d.type === 'CONGTO' && !kind.has(id(d.serial)));

console.log(`\nPB: ${PB_URL}`);
console.log(`File: TI vuông ${vuong.size} · công tơ có loại ${kind.size} (ME42 trực tiếp ${[...kind.values()].filter(k => k === 'truc_tiep').length}) · xung đột trong file ${conflict.size}`);
console.log(`Công tơ PB đã đúng loại theo file: ${sameKind}`);
console.log(`SẼ SỬA ${plan.length}:`);
plan.forEach(([, , why]) => console.log(`  · ${why}`));
if (conflict.size) console.log(`Xung đột trong file (bỏ qua): ${[...conflict].join(', ')}`);
if (notTi.length) console.log(`Khác loại thiết bị (bỏ qua): ${notTi.join('; ')}`);
if (missing.length) console.log(`Có trong file, KHÔNG có trong kho PB (${missing.length}): ${missing.join(', ')}`);
console.log(`Công tơ trong PB không có trong file (${pbMetersNotInFile.length}): `
  + pbMetersNotInFile.map(d => `${d.serial}${d.meter_kind ? `=${d.meter_kind}` : '(trống)'}`).join(', '));

if (!COMMIT) { console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --commit để ghi thật.'); process.exit(0); }
let n = 0;
for (const [d, patch, why] of plan) {
  const r = await fetch(`${PB_URL}/api/collections/dm_device/records/${d.id}`, {
    method: 'PATCH', headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    console.error(`\nDỪNG sau ${n}/${plan.length}: ${why} → HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  n++;
}
console.log(`\nXong ${n}/${plan.length}. Chạy lại không --commit để kiểm tra (phải còn 0).`);
