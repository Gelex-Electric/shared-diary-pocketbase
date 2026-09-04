#!/usr/bin/env node
/**
 * Excel còn ĐIỂM ĐO nào PocketBase chưa khai không? CHỈ ĐỌC.
 *
 * KHÔNG so theo mã điểm đo: hai bên đặt tên khác nhau (`03.LOGOS.T1.1000kVA`
 * bên Excel là `03.LOGOI.T1.2500kVA` bên PB), so mã thô cho ra hàng trăm khác
 * biệt giả. So theo SỐ CHẾ TẠO — thứ định danh không đổi khi đổi tên.
 *
 * Cách làm: sổ giao dịch của Excel dựng ra "điểm đo này từng treo những số
 * nào", rồi tra từng số đó trong `dm_asset`. Điểm đo bên Excel mà mọi số của
 * nó đều có mặt trên PB thì coi như ĐÃ KHAI, dù mang tên khác.
 *
 * Điểm đo Excel KHÔNG có giao dịch nào thì không đối chiếu kiểu này được —
 * tách riêng thành một mục để soi tay.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_excel_coverage.mjs
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';

const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx'))
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/9. Quản lý kho/Quản lý kho V2.xlsx';
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
const [points, assets, customers] = await Promise.all(
  ['dm_point', 'dm_asset', 'dm_customer'].map(allOf));

const norm = (s) => String(s ?? '').trim().toUpperCase();
/** Bỏ dấu chấm/ngoặc/khoảng trắng để so mã giữa hai lối đặt tên. */
const loose = (s) => norm(s).replace(/[\s.()-]/g, '');

const codeOfPoint = Object.fromEntries(points.map(p => [p.id, p.code || p.line_name || '(chưa có mã)']));
/** số chế tạo -> các điểm đo bên PB đang giữ nó */
const pbAt = new Map();
for (const a of assets) {
  const s = norm(a.serial);
  if (!s) continue;
  pbAt.set(s, new Set([...(pbAt.get(s) ?? []), codeOfPoint[a.point] ?? '(không gắn điểm đo)']));
}
const pbLoose = new Set(points.map(p => loose(p.code || p.line_name)));

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const J = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
const xPoints = J('Quản lý điểm đo');
const xTrans = J('Quản lý giao dịch');

/**
 * điểm đo Excel -> tập số chế tạo ĐƯỢC GÁN cho nó, theo MỌI loại giao dịch.
 *
 * KHÔNG lọc `LOAIGD` theo "Treo tháo". Sổ Excel gán vật tư cho điểm đo bằng cả
 * "Nhập kho" lẫn "Treo tháo", và ranh giới không nhất quán: bộ TI của
 * YM.TITAN.NX10/11/12 vào bằng "Nhập kho", còn cả ba trạm TRRBW thì TOÀN BỘ
 * 18 dòng (công tơ, TI, GP-03) đều là "Nhập kho".
 *
 * Bản trước lọc theo "Treo tháo" nên coi TRRBW-1/2/3 là "không có giao dịch",
 * rồi báo nhầm rằng PB đã phủ hết điểm đo có vật tư. Đếm thiếu kiểu này còn
 * nguy hơn không đếm, vì nó im lặng.
 */
const xAt = new Map();
for (const t of xTrans) {
  const dd = String(t.DDDK ?? '').trim();
  const id = norm(t.ID);
  if (dd && id) xAt.set(dd, new Set([...(xAt.get(dd) ?? []), id]));
}

const missing = [];   // không số nào có trên PB
const partial = [];   // có một phần
for (const [dd, ids] of xAt) {
  const hit = [...ids].filter(s => pbAt.has(s));
  if (hit.length === ids.size) continue;
  const row = { dd, ids, hit, lack: [...ids].filter(s => !pbAt.has(s)) };
  (hit.length ? partial : missing).push(row);
}

/*
  Điểm đo Excel KHÔNG có giao dịch treo nào thì không có số chế tạo để tra.
  So bằng mã cũng không xong: SINTEC vừa nạp xong với mã `T1…T9` nên mã Excel
  `1TR1…TC` không khớp gì cả.

  Nên so bằng cặp KHÁCH HÀNG + CÔNG SUẤT — hai thứ Excel và PB đều ghi, và
  không đổi khi đổi tên. Đếm theo cặp đó: Excel có 4 trạm 1500kVA của SINTEC mà
  PB chỉ có 3 thì còn thiếu 1.
*/
const stationsPb = await allOf('dm_station');
const stOf = Object.fromEntries(stationsPb.map(s => [s.id, s]));
const mkhOfCus = Object.fromEntries(customers.map(c => [c.id, c.mkh]));
/**
 * Công suất trong mã: chỉ nhận CỤM SỐ NGUYÊN đứng ngay trước `kVA`, và phải
 * bắt đầu sau dấu chấm phân đoạn hoặc đầu chuỗi.
 *
 * Không dùng `(\d+([.,]\d+)?)` được: `T1.1500kVA` thì dấu chấm phân đoạn bị
 * đọc thành dấu thập phân, ra 1.15 thay vì 1500 — sai này đã làm cả 9 trạm
 * SINTEC vừa nạp xong vẫn bị báo là thiếu.
 */
const kvaOf = (code) => {
  const m = /(?:^|\.)(\d+)\s*KVA/i.exec(String(code));
  return m ? Number(m[1]) : null;
};

/** đếm điểm đo PB theo "MKH|kVA" */
const pbPairs = new Map();
for (const p of points) {
  const st = stOf[p.station];
  const key = `${mkhOfCus[p.customer] ?? '?'}|${st?.sdm_kva ?? '?'}`;
  pbPairs.set(key, (pbPairs.get(key) ?? 0) + 1);
}

/** Kho ảo của Excel: PB không có khái niệm này, cố ý không nạp. */
const isWarehouse = (code, mkh) =>
  /GETC|DỰ PHÒNG|THU HỒI|TRẢ/i.test(code) || /-000$/.test(mkh) || mkh === 'GETC';

const xPairs = new Map();
const noTrans = xPoints
  .map(r => ({
    code: String(r['Mã điểm đo'] ?? '').trim(), mkh: String(r.MKH ?? '').trim(),
    st: String(r['Trạng thái hoạt động'] ?? '').trim(),
  }))
  .filter(r => r.code && !xAt.has(r.code))
  .map(r => {
    const kva = kvaOf(r.code);
    const key = `${r.mkh}|${kva ?? '?'}`;
    xPairs.set(key, (xPairs.get(key) ?? 0) + 1);
    return { ...r, kva, key, kho: isWarehouse(r.code, r.mkh) };
  })
  // Đủ chỗ trên PB cho cặp MKH+kVA này chưa? Cặp thứ n cần PB có >= n bản ghi.
  .map((r, _i, arr) => {
    const nth = arr.filter(x => x.key === r.key && arr.indexOf(x) <= arr.indexOf(r)).length;
    return { ...r, onPb: r.kho || (pbPairs.get(r.key) ?? 0) >= nth };
  });

/* ------------------------------- In ra ------------------------------- */
console.log(`Điểm đo bên Excel      : ${xPoints.length}`);
console.log(`  có giao dịch vật tư  : ${xAt.size}   → PB đủ ${xAt.size - missing.length - partial.length}, thiếu một phần ${partial.length}, chưa khai ${missing.length}`);
console.log(`  KHÔNG có giao dịch   : ${noTrans.length}   → kho ảo của Excel ${noTrans.filter(r => r.kho).length}, PB đã có ${noTrans.filter(r => r.onPb && !r.kho).length}, CHƯA THẤY ${noTrans.filter(r => !r.onPb).length}`);
console.log(`Điểm đo trên PocketBase: ${points.length}`);

if (missing.length) {
  console.log(`\n=== CHƯA KHAI — không số chế tạo nào của nó có trên PB (${missing.length}) ===`);
  for (const m of missing) console.log(`  ${m.dd.padEnd(38)} ${m.ids.size} vật tư: ${[...m.ids].join(', ')}`);
}
if (partial.length) {
  console.log(`\n=== KHAI THIẾU VẬT TƯ (${partial.length}) ===`);
  for (const m of partial) {
    const at = [...new Set(m.hit.flatMap(s => [...pbAt.get(s)]))].join(', ');
    console.log(`  ${m.dd.padEnd(38)} ${m.hit.length}/${m.ids.size} — trên PB là "${at}", thiếu: ${m.lack.join(', ')}`);
  }
}
const orphan = noTrans.filter(r => !r.onPb);
if (orphan.length) {
  console.log(`\n=== CHƯA THẤY TRÊN PB — không giao dịch, không khớp MKH+kVA (${orphan.length}) ===`);
  for (const r of orphan) console.log(`  ${r.code.padEnd(38)} ${r.mkh.padEnd(12)} ${String(r.kva ?? '?').padStart(5)}kVA  ${r.st}`);
}
