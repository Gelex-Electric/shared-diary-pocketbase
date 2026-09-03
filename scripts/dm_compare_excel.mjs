#!/usr/bin/env node
/**
 * Đối chiếu file "Quản lý kho V2.xlsx" với danh mục `dm_*` trên PocketBase.
 *
 * CHỈ ĐỌC cả hai phía — không ghi gì, không sửa gì. Mục đích là biết hai nguồn
 * đang lệch nhau ở đâu trước khi quyết định nạp cái nào vào cái nào.
 *
 * Đọc HẾT bản ghi có phân trang: `dm_asset` đã vượt 500 nên lấy một trang là
 * thiếu im lặng (đã vấp ba lần trong ngày 25/08/2026).
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_compare_excel.mjs [đường-dẫn-xlsx]
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';

const XLSX_PATH = process.argv[2]
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/9. Quản lý kho/Quản lý kho V2.xlsx';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/* ----------------------------- PocketBase ----------------------------- */
const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

const allOf = async col => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await (await fetch(`${PB}/api/collections/${col}/records?perPage=500&page=${page}`, { headers: H })).json();
    out.push(...(r.items ?? []));
    if (page >= (r.totalPages ?? 1)) return out;
  }
};

const zones = await allOf('dm_zone');
const customers = await allOf('dm_customer');
const stations = await allOf('dm_station');
const points = await allOf('dm_point');
const assets = await allOf('dm_asset');

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const J = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });
const xKcn = J('Quản lý KCN');
const xCus = J('Quản lý khách hàng');
const xPoint = J('Quản lý điểm đo');
const xAsset = J('Quản lý vật tư');
const xTrans = J('Quản lý giao dịch');

/* ------------------------------ tiện ích ------------------------------ */
const norm = s => String(s ?? '').trim().toUpperCase();
/** Bỏ dấu chấm/khoảng trắng để so mã điểm đo giữa hai cách đặt tên khác nhau. */
const loose = s => norm(s).replace(/[\s.()]/g, '');
const setOf = arr => new Set(arr.filter(Boolean));
const diff = (a, b) => [...a].filter(x => !b.has(x)).sort();
/**
 * Số serial ngày của Excel → `YYYY-MM-DD`.
 *
 * Tự quy đổi chứ không dùng `XLSX.SSF`: bản xlsx trong dự án là bản ESM cho
 * trình duyệt, không kèm module SSF. Mốc 0 của Excel là 30/12/1899.
 */
const xlDate = v => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const ms = Math.round((v - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const line = t => console.log(t);
const H2 = t => { console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`); };

/* ------------------------------- 1. KCN ------------------------------- */
H2('1. KHU CÔNG NGHIỆP');
const pbZone = setOf(zones.map(z => norm(z.code)));
const xlZone = setOf(xKcn.map(r => norm(r['Mã KCN'])));
line(`Excel ${xlZone.size} · PocketBase ${pbZone.size}`);
line(`Chỉ có ở Excel : ${diff(xlZone, pbZone).join(', ') || '—'}`);
line(`Chỉ có ở PB    : ${diff(pbZone, xlZone).join(', ') || '—'}`);

/* ---------------------------- 2. Khách hàng ---------------------------- */
H2('2. KHÁCH HÀNG');
const pbCus = new Map(customers.map(c => [norm(c.mkh), c]));
const xlCus = new Map(xCus.map(r => [norm(r.MKH), r]));
line(`Excel ${xlCus.size} · PocketBase ${pbCus.size}`);
const cusOnlyXl = diff(new Set(xlCus.keys()), new Set(pbCus.keys()));
const cusOnlyPb = diff(new Set(pbCus.keys()), new Set(xlCus.keys()));
line(`Chỉ có ở Excel (${cusOnlyXl.length}): ${cusOnlyXl.join(', ') || '—'}`);
line(`Chỉ có ở PB    (${cusOnlyPb.length}): ${cusOnlyPb.join(', ') || '—'}`);

const nameDiff = [], shortDiff = [];
for (const [mkh, x] of xlCus) {
  const p = pbCus.get(mkh);
  if (!p) continue;
  if (norm(x['Tên khách hàng']) !== norm(p.name)) nameDiff.push({ mkh, xl: x['Tên khách hàng'], pb: p.name });
  if (norm(x['Tên tắt']) !== norm(p.short_name)) shortDiff.push({ mkh, xl: x['Tên tắt'], pb: p.short_name });
}
line(`\nLệch TÊN khách hàng: ${nameDiff.length}`);
for (const x of nameDiff.slice(0, 15)) line(`   ${x.mkh}\n      Excel: ${x.xl}\n      PB   : ${x.pb}`);
line(`\nLệch TÊN TẮT: ${shortDiff.length}`);
for (const x of shortDiff.slice(0, 20)) line(`   ${x.mkh.padEnd(12)} Excel "${x.xl}"  ≠  PB "${x.pb}"`);

/* ----------------------------- 3. Điểm đo ----------------------------- */
H2('3. ĐIỂM ĐO');
const pbPointByLoose = new Map();
for (const p of points) pbPointByLoose.set(loose(p.code || p.line_name || ''), p);
const xlPointRows = xPoint.filter(r => r['Mã điểm đo']);
line(`Excel ${xlPointRows.length} · PocketBase ${points.length}`);

const matched = [], onlyXl = [];
for (const r of xlPointRows) {
  const k = loose(r['Mã điểm đo']);
  if (pbPointByLoose.has(k)) matched.push({ xl: r, pb: pbPointByLoose.get(k) });
  else onlyXl.push(r);
}
const matchedKeys = new Set(matched.map(m => loose(m.pb.code || m.pb.line_name || '')));
const onlyPb = points.filter(p => !matchedKeys.has(loose(p.code || p.line_name || '')));
line(`Khớp mã (bỏ dấu chấm/ngoặc): ${matched.length}`);
line(`Chỉ có ở Excel: ${onlyXl.length}`);
line(`Chỉ có ở PB   : ${onlyPb.length}`);
line('\n— 25 mã chỉ có ở Excel:');
for (const r of onlyXl.slice(0, 25)) line(`   ${String(r['Mã điểm đo']).padEnd(38)} ${r.MKH ?? ''} · ${r['Trạng thái hoạt động'] ?? ''}`);
line('\n— 25 mã chỉ có ở PB:');
for (const p of onlyPb.slice(0, 25)) line(`   ${String(p.code || p.line_name || p.id).padEnd(38)} ${p.status ?? ''}`);

/* ------------------------------ 4. Vật tư ------------------------------ */
H2('4. VẬT TƯ');
/** Ánh xạ loại vật tư Excel → `dm_asset.type`. */
const TYPE = { 'GP-03': 'GP03', ME41: 'CONGTO', ME42: 'CONGTO', TI: 'TI', Sim: 'SIM', SIM: 'SIM' };
const xlAssetRows = xAsset.filter(r => r['Số ID']);
const xlBySerial = new Map(xlAssetRows.map(r => [norm(r['Số ID']), r]));
const pbBySerial = new Map();
for (const a of assets) {
  const k = norm(a.serial);
  pbBySerial.set(k, [...(pbBySerial.get(k) ?? []), a]);
}
line(`Excel ${xlBySerial.size} số ID · PocketBase ${pbBySerial.size} số chế tạo (${assets.length} bản ghi)`);

const asOnlyXl = diff(new Set(xlBySerial.keys()), new Set(pbBySerial.keys()));
const asOnlyPb = diff(new Set(pbBySerial.keys()), new Set(xlBySerial.keys()));
line(`\nChỉ có ở Excel: ${asOnlyXl.length}`);
const byTypeXl = {};
for (const s of asOnlyXl) {
  const t = xlBySerial.get(s)['Loại vật tư'];
  byTypeXl[t] = (byTypeXl[t] ?? 0) + 1;
}
line(`   theo loại: ${JSON.stringify(byTypeXl)}`);
for (const s of asOnlyXl.slice(0, 20)) {
  const r = xlBySerial.get(s);
  line(`   ${String(r['Loại vật tư']).padEnd(6)} ${s.padEnd(18)} ${r['Ghi chú'] ?? ''}`);
}

line(`\nChỉ có ở PB: ${asOnlyPb.length}`);
const byTypePb = {};
for (const s of asOnlyPb) {
  const t = pbBySerial.get(s)[0].type;
  byTypePb[t] = (byTypePb[t] ?? 0) + 1;
}
line(`   theo loại: ${JSON.stringify(byTypePb)}`);
for (const s of asOnlyPb.slice(0, 20)) {
  const a = pbBySerial.get(s)[0];
  line(`   ${String(a.type).padEnd(6)} ${s.padEnd(18)} ${a.active ? 'đang treo' : 'đã tháo'}`);
}

/* lệch LOẠI giữa hai bên */
const typeDiff = [];
for (const [s, r] of xlBySerial) {
  const pb = pbBySerial.get(s);
  if (!pb) continue;
  const want = TYPE[r['Loại vật tư']] ?? '?';
  if (!pb.some(a => a.type === want)) {
    typeDiff.push(`${s}: Excel ${r['Loại vật tư']} (→${want}) ≠ PB ${[...new Set(pb.map(a => a.type))].join('/')}`);
  }
}
line(`\nLệch LOẠI vật tư: ${typeDiff.length}`);
for (const t of typeDiff.slice(0, 20)) line(`   ${t}`);

/* --------------------------- 5. SIM & đo xa --------------------------- */
H2('5. SIM — nguồn bổ sung cho các điểm đo đang thiếu đo xa');
const xlSim = xlAssetRows.filter(r => TYPE[r['Loại vật tư']] === 'SIM');
const pbSim = assets.filter(a => a.type === 'SIM');
line(`Excel ${xlSim.length} SIM · PocketBase ${pbSim.length} SIM`);
const simOnlyXl = xlSim.filter(r => !pbBySerial.has(norm(r['Số ID'])));
line(`SIM có ở Excel mà PB chưa có: ${simOnlyXl.length}`);
for (const r of simOnlyXl.slice(0, 15)) line(`   ${r['Số ID']}  ${r['Ghi chú'] ?? ''}`);

/* -------------------------- 6. Sổ giao dịch -------------------------- */
H2('6. SỔ GIAO DỊCH — nguồn ngày treo/tháo');
const treo = xTrans.filter(r => String(r.LOAIGD).toLowerCase().startsWith('treo'));
line(`${xTrans.length} giao dịch, trong đó "Treo tháo": ${treo.length}`);
const dates = treo.map(r => xlDate(r.NGAYGD)).filter(Boolean).sort();
line(`Khoảng thời gian: ${dates[0]} → ${dates[dates.length - 1]}`);

/* vật tư PB chưa có ngày treo mà sổ giao dịch CÓ */
const noDateOn = assets.filter(a => !a.date_on);
const treoBySerial = new Map();
for (const r of treo) {
  const k = norm(r.ID);
  const d = xlDate(r.NGAYGD);
  if (!k || !d) continue;
  if (!treoBySerial.has(k) || d < treoBySerial.get(k)) treoBySerial.set(k, d);
}
const fixable = noDateOn.filter(a => treoBySerial.has(norm(a.serial)));
line(`\nVật tư trên PB CHƯA có ngày treo: ${noDateOn.length}`);
line(`   trong đó sổ giao dịch có ngày treo → bổ sung được: ${fixable.length}`);
for (const a of fixable.slice(0, 20)) {
  line(`   ${String(a.type).padEnd(6)} ${String(a.serial).padEnd(18)} → ${treoBySerial.get(norm(a.serial))}`);
}
