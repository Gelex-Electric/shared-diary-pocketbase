#!/usr/bin/env node
/**
 * PocketBase đã phủ hết HAI file Excel chưa? CHỈ ĐỌC.
 *
 *   1. "Quản lý kho V2.xlsx"  — điểm đo + vật tư + sổ giao dịch
 *   2. "Danh sách sim.xlsx"   — kho SIM
 *
 * Hai điều đã học bằng cách làm sai, ghi lại để đừng lặp:
 *
 * - KHÔNG lọc sổ giao dịch theo `LOAIGD ~ "Treo tháo"`. Excel gán vật tư cho
 *   điểm đo bằng CẢ "Nhập kho" lẫn "Treo tháo", không nhất quán: bộ TI của
 *   NX10/11/12 vào bằng "Nhập kho", cả ba trạm TRRBW thì 18/18 dòng đều là
 *   "Nhập kho". Lọc theo "treo" là bỏ sót im lặng.
 *
 * - KHÔNG so theo mã điểm đo, chỉ so theo SỐ CHẾ TẠO. Hai bên đặt tên khác
 *   nhau (`03.LOGOS.T1` ↔ `03.LOGOI.T1`), so mã ra hàng trăm khác biệt giả.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_all_excel.mjs
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';

const KHO = process.env.XLSX_KHO
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/9. Quản lý kho/Quản lý kho V2.xlsx';
const SIM = process.env.XLSX_SIM
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/10. KHo/Danh sách sim.xlsx';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

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
const [points, assets, devices] = await Promise.all(
  ['dm_point', 'dm_asset', 'dm_device'].map(allOf));
const codeOf = Object.fromEntries(points.map(p => [p.id, p.code || p.line_name || '(chưa có mã)']));

const N = (s) => String(s ?? '').replace(/^'+/, '').trim().toUpperCase();
/*
  "PB đã có số No này chưa" nay phải hỏi `dm_device`, KHÔNG chỉ `dm_asset`.

  Từ schema v13, thiết bị tồn kho tồn tại độc lập với lần lắp — hàng chưa gắn
  điểm đo nào vẫn nằm trong PB. Đếm theo `dm_asset` như bản trước sẽ báo thiếu
  hàng loạt SIM và hàng dự phòng vừa nạp xong.
*/
const pbAt = new Map();
for (const d of devices) {
  const s = N(d.serial);
  if (s) pbAt.set(s, new Set(['(trong kho)']));
}
for (const a of assets) {
  const s = N(a.serial);
  if (!s) continue;
  const at = codeOf[a.point] ?? '(không gắn)';
  const cur = pbAt.get(s) ?? new Set();
  cur.delete('(trong kho)');
  pbAt.set(s, new Set([...cur, at]));
}

const stamp = (f) => `${(fs.statSync(f).size / 1024).toFixed(0)} KB · sửa ${fs.statSync(f).mtime.toISOString().slice(0, 16).replace('T', ' ')}`;

/* ===================== 1. Quản lý kho V2.xlsx ===================== */
const wb = XLSX.read(fs.readFileSync(KHO));
const J = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
const xTrans = J('Quản lý giao dịch');
const xAssets = J('Quản lý vật tư');

/** Kho ảo của Excel — PB cố ý không có khái niệm này. */
const isWarehouse = (dd) => /GETC|DỰ PHÒNG|DU PHONG|THU HỒI|THU HOI|TRẢ|^TRA$/i.test(dd);

/** điểm đo Excel -> số chế tạo được gán, theo MỌI loại giao dịch. */
const xAt = new Map();
for (const t of xTrans) {
  const dd = String(t.DDDK ?? '').trim();
  const id = N(t.ID);
  if (dd && id) xAt.set(dd, new Set([...(xAt.get(dd) ?? []), id]));
}

const real = [...xAt.entries()].filter(([dd]) => !isWarehouse(dd));
const kho = [...xAt.entries()].filter(([dd]) => isWarehouse(dd));
const missing = [], partial = [];
for (const [dd, ids] of real) {
  const lack = [...ids].filter(s => !pbAt.has(s));
  if (!lack.length) continue;
  (lack.length === ids.size ? missing : partial).push({ dd, ids, lack });
}

console.log(`FILE 1 — Quản lý kho V2.xlsx   (${stamp(KHO)})`);
console.log(`  Điểm đo có vật tư trong sổ : ${xAt.size}  (thật ${real.length}, kho ảo ${kho.length})`);
console.log(`  PB phủ ĐỦ                  : ${real.length - missing.length - partial.length}`);
console.log(`  Khai THIẾU vật tư          : ${partial.length}`);
console.log(`  CHƯA khai gì               : ${missing.length}`);

const lackAll = new Set();
if (missing.length) {
  console.log('\n  --- CHƯA KHAI ---');
  for (const m of missing) {
    m.lack.forEach(s => lackAll.add(s));
    console.log(`    ${m.dd.padEnd(34)} ${m.ids.size} vật tư: ${m.lack.join(', ')}`);
  }
}
if (partial.length) {
  console.log('\n  --- KHAI THIẾU ---');
  for (const m of partial) {
    m.lack.forEach(s => lackAll.add(s));
    console.log(`    ${m.dd.padEnd(34)} thiếu ${m.lack.length}/${m.ids.size}: ${m.lack.join(', ')}`);
  }
}
console.log(`\n  ⇒ Tổng vật tư ĐÃ GÁN ĐIỂM ĐO mà PB chưa có: ${lackAll.size}`);

/* Sổ vật tư: số nào chưa từng gán điểm đo nào = tồn kho. */
const assigned = new Set([...xAt.values()].flatMap(s => [...s]));
const stock = xAssets.map(r => N(r['Số ID'])).filter(s => s && !assigned.has(s) && !pbAt.has(s));
console.log(`  ⇒ Tồn kho (chưa gán điểm đo nào, PB không chứa được): ${stock.length}`);

/* ===================== 2. Danh sách sim.xlsx ===================== */
const wb2 = XLSX.read(fs.readFileSync(SIM));
const simRows = XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { defval: null });
const sims = simRows.map(r => ({ serial: N(r['Số']), hint: String(r['Khách hàng đã biết'] ?? '').trim() }))
  .filter(r => /^\d{15,20}$/.test(r.serial));
const simOnPb = sims.filter(s => pbAt.has(s.serial));
const simOff = sims.filter(s => !pbAt.has(s.serial));

console.log(`\nFILE 2 — Danh sách sim.xlsx   (${stamp(SIM)})`);
console.log(`  SIM trong file      : ${sims.length}`);
console.log(`  Đã có trên PB       : ${simOnPb.length}`);
console.log(`  CHƯA có trên PB     : ${simOff.length}  (trong đó ${simOff.filter(s => s.hint).length} có ghi chú khách hàng)`);
if (simOff.filter(s => s.hint).length) {
  console.log('\n  --- SIM chưa khai mà CÓ ghi chú khách hàng ---');
  for (const s of simOff.filter(x => x.hint)) console.log(`    ${s.serial}  "${s.hint}"`);
}

console.log(`\nPocketBase: ${points.length} điểm đo · ${assets.length} vật tư (${pbAt.size} số chế tạo)`);
