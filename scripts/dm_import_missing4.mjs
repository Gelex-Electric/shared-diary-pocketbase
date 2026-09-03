#!/usr/bin/env node
/**
 * Nạp 4 điểm đo Excel có vật tư ĐÃ TREO mà PocketBase chưa khai:
 *   YM.TITAN.NX10.560kVA · NX11 · NX12   (trạm đã có sẵn, thiếu mỗi điểm đo)
 *   YM.MATIN.T1.320kVA                   (chưa có cả trạm)
 *
 * Khác hẳn đợt SINTEC: ở đây sổ giao dịch CÓ dòng "Treo tháo", nên vật tư có
 * NGÀY TREO thật và điểm đo sẽ ra trạng thái đã vận hành chứ không phải dự
 * kiến. Ngày lấy đúng từ `NGAYGD` của dòng treo, không bịa.
 *
 * Tỷ số TI (cột `TSTI`) được nạp để suy HSN bằng `deriveHsn` của app — không
 * đặt tay, không để rơi về 1.
 *
 * Mặc định CHẠY THỬ. Thêm `--apply` mới ghi:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_import_missing4.mjs
 */
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APPLY = process.argv.includes('--apply');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const XLSX_PATH = process.argv.find(a => a.endsWith('.xlsx'))
  || 'C:/Users/thang.nguyen-manh/OneDrive - GELEX/Tệp của Nguyen Tai Dung - 2. GETC - Hồ sơ lưu KT-VH/9. Quản lý kho/Quản lý kho V2.xlsx';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/** Điểm đo Excel cần nạp -> khách hàng của ĐIỂM ĐO (có thể khác chủ trạm). */
const WANT = [
  { excel: 'YM.TITAN.NX10.560kVA', mkh: 'KCNYM-005', ident: 'NX10', sdmKva: 560 },
  { excel: 'YM.TITAN.NX11.560kVA', mkh: 'KCNYM-005', ident: 'NX11', sdmKva: 560 },
  { excel: 'YM.TITAN.NX12.560kVA', mkh: 'KCNYM-005', ident: 'NX12', sdmKva: 560 },
  { excel: 'YM.MATIN.T1.320kVA', mkh: 'KCNYM-018', ident: 'T1', sdmKva: 320 },
];

/* Dùng ĐÚNG hàm của app, không chép lại quy tắc. */
const tmp = mkdtempSync(join(tmpdir(), 'dm-'));
const load = async (rel, name) => {
  const f = join(tmp, `${name}.mjs`);
  await build({ entryPoints: [join(ROOT, rel)], outfile: f, bundle: true,
    format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(f).href);
};
const { buildStationCode, buildPointCode } = await load('src/lib/dm/naming.ts', 'naming');
const { deriveHsn, pickRatio, connectionOfHsn, parseRatio } = await load('src/lib/dm/hsn.ts', 'hsn');
rmSync(tmp, { recursive: true, force: true });

/* ----------------------------- PocketBase ----------------------------- */
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
const [zones, customers, stations, points, assets] = await Promise.all(
  ['dm_zone', 'dm_customer', 'dm_station', 'dm_point', 'dm_asset'].map(allOf));

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const xTrans = XLSX.utils.sheet_to_json(wb.Sheets['Quản lý giao dịch'], { defval: null });

/**
 * Số serial ngày của Excel -> `YYYY-MM-DD`.
 * Excel đếm ngày từ 1899-12-30 (mốc 25569 ngày trước epoch Unix).
 */
const ymdOf = (v) => {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v).slice(0, 10);
  return new Date(Math.round((n - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
};

/** ME41/ME42 là công tơ; GP-03 -> GP03 theo bảng loại của app. */
const typeOf = (t) => /^me4/i.test(t) ? 'CONGTO'
  : /gp-?03/i.test(t) ? 'GP03'
    : /sim/i.test(t) ? 'SIM'
      : /^ti$/i.test(t) ? 'TI'
        : /^tu$/i.test(t) ? 'TU' : 'KHAC';

/**
 * CHỈ nhận ra GP-03 từ dạng số, không đoán gì khác.
 *
 * IMEI của GP-03 là 15 chữ số bắt đầu `869` — không loại nào khác có dạng đó,
 * nên bắt được lỗi gõ nhầm cột `LOAIVT` (SINTEC có một GP-03 bị ghi là ME41).
 *
 * KHÔNG đoán công tơ theo dạng "10 chữ số bắt đầu bằng 2": TI cũng đúng dạng
 * ấy (`2620400694` là TI ở 03.AQ). Bản đầu của script này đoán như vậy và đã
 * biến CẢ BỘ 3 TI 500/5 của MATIN thành 3 công tơ — sai tới mức làm HSN rơi về
 * 1. Dạng số chỉ phân biệt được GP-03; còn lại tin cột `LOAIVT`.
 */
const looksLike = (s) => /^869\d{12}$/.test(s) ? 'GP03' : null;

const typeWarn = [];
const plan = [];
for (const w of WANT) {
  const cus = customers.find(c => c.mkh === w.mkh);
  if (!cus) { console.error(`Không có khách hàng ${w.mkh} trên PB`); process.exit(1); }
  const zone = zones.find(z => z.id === cus.zone);
  if (!zone) { console.error(`Khách ${w.mkh} chưa gắn KCN`); process.exit(1); }

  const parts = { zoneCode: zone.code, customerShortName: cus.short_name ?? '',
    ident: w.ident, sdmKva: w.sdmKva };
  const stationCode = buildStationCode(parts);
  // Khách hàng của điểm đo = chủ trạm => không đuôi => mã điểm đo trùng mã trạm.
  const pointCode = buildPointCode({ ...parts, isSub: false });

  /*
    LẤY CẢ "Nhập kho" LẪN "Treo tháo".

    Sổ Excel chia vật tư của cùng một điểm đo ra hai loại giao dịch: bộ TI vào
    bằng dòng "Nhập kho", còn công tơ và GP-03 vào bằng "Treo tháo" (hoặc ngược
    lại ở MATIN). Bản đầu của script chỉ lọc "Treo tháo" nên mất sạch TI của 3
    trạm TITAN, kéo theo HSN không suy được.
  */
  const rows = xTrans.filter(t => String(t.DDDK ?? '').trim() === w.excel);

  const items = rows.map(t => {
    const serial = String(t.ID).trim();
    let type = typeOf(String(t.LOAIVT));
    const guess = looksLike(serial);
    if (guess && guess !== type) { typeWarn.push({ excel: w.excel, serial, from: type, to: guess }); type = guess; }
    const r = parseRatio(String(t.TSTI ?? ''));
    /*
      KHÔNG ĐIỀN NGÀY TREO cho bất cứ dòng nào (user chốt 28/08/2026): 4 điểm đo
      này là DỰ KIẾN, công trình chưa xây xong.

      Sổ Excel có dòng "Treo tháo" mang ngày 19/07 và 28/07, nhưng đó là thao
      tác kho — xuất vật tư giao cho công trình — chứ không phải đã lắp lên lưới
      và đóng điện. Điền ngày đó vào `date_on` là biến điểm đo thành "đã vận
      hành", kéo theo cả cảnh báo thiếu hóa đơn lẫn cảnh báo thiếu đo xa, toàn
      tiếng ồn giả.

      Bỏ trống ngày treo thì cả 4 ra đúng trạng thái "Dự kiến", và khi công
      trình đóng điện thật thì khai ngày treo một lần trên giao diện.
    */
    return { serial, type, dateOn: '',
      kind: /treo/i.test(String(t.LOAIGD)) ? 'treo' : 'kho', gd: ymdOf(t.NGAYGD),
      ratio: String(t.TSTI ?? '').trim(), primary: r.primary, secondary: r.secondary };
  });

  /*
    Bộ dòng suy HSN: ưu tiên vật tư ĐÃ TREO, cả bộ còn dự kiến thì lấy chính
    các dòng dự kiến — đúng luật `hsnRows` trong form của app (27/08/2026). Ở
    đây không dòng nào có ngày treo nên rơi vào vế thứ hai, và HSN vẫn suy được
    từ tỷ số TI: điểm đo dự kiến vẫn phải hiện HSN.
  */
  const hung = items.filter(x => x.dateOn);
  const hsnRows = hung.length ? hung : items;
  const set = (ty) => pickRatio(hsnRows.filter(x => x.type === ty && x.primary != null)
    .map(x => ({ primary: x.primary, secondary: x.secondary, active: true })));
  const hasTi = hsnRows.some(x => x.type === 'TI');
  /*
    KHÔNG có TI trong sổ Excel thì BỎ TRỐNG HSN, không lấy `deriveHsn` = 1.

    `deriveHsn` trả 1 khi không có TI vì trong FORM của app, "không khai TI" là
    người dùng chủ động nói điểm đo đo thẳng. Ở đây thì khác: sổ Excel đơn giản
    là không ghi TI (nó chỉ theo dõi công tơ và GP-03 cho mấy trạm này). Trạm
    560kVA mà đo thẳng là chuyện không thể — ghi HSN = 1 xuống là đúng con lỗi
    đã làm 8 điểm đo khác sai sáng nay.
  */
  const hsn = hasTi ? deriveHsn({ hasTi, ti: set('TI'), tu: set('TU') }) : null;

  plan.push({ ...w, cus, zone, stationCode, pointCode, items, hsn,
    stationExists: stations.find(s => s.code === stationCode),
    pointExists: points.find(p => p.code === pointCode) });
}

/* ------------------------------ Va chạm ------------------------------ */
const clash = [];
for (const p of plan) {
  for (const it of p.items) {
    const other = assets.find(a => String(a.serial).trim() === it.serial);
    if (other) {
      const at = points.find(x => x.id === other.point);
      clash.push(`số No ${it.serial} đã gắn ở ${at?.code ?? '(không rõ)'}`);
    }
  }
}

/* ------------------------------- In ra ------------------------------- */
for (const p of plan) {
  console.log(`\n${p.excel}   [${p.cus.mkh} — ${p.cus.name}]`);
  console.log(`  TRẠM   ${p.stationCode}   ${p.stationExists ? 'ĐÃ CÓ, dùng lại' : 'TẠO MỚI'}`);
  console.log(`  ĐIỂM   ${p.pointCode}   ${p.pointExists ? 'ĐÃ CÓ' : 'TẠO MỚI'} · chính · `
    + `HSN ${p.hsn ?? 'CHƯA SUY ĐƯỢC'} · ${p.hsn != null ? connectionOfHsn(p.hsn) : 'gian_tiep'}`);
  for (const it of p.items) {
    console.log(`     ${it.type.padEnd(7)} ${it.serial.padEnd(20)} `
      + `treo ${(it.dateOn || 'DỰ KIẾN').padEnd(10)} ${(it.ratio ? `tỷ số ${it.ratio}` : '').padEnd(14)}`
      + `[${it.kind === 'treo' ? 'Treo tháo' : `Nhập kho ${it.gd}`}]`);
  }
}
const nA = plan.reduce((n, p) => n + p.items.length, 0);
console.log(`\nSẼ TẠO: ${plan.filter(p => !p.stationExists).length} trạm · `
  + `${plan.filter(p => !p.pointExists).length} điểm đo · ${nA} vật tư`);
if (typeWarn.length) {
  console.log(`\nEXCEL GHI SAI LOẠI (${typeWarn.length}) — sửa theo dạng số chế tạo:`);
  for (const w of typeWarn) console.log(`   ${w.serial} ở ${w.excel}: ${w.from} → ${w.to}`);
}
const noHsn = plan.filter(p => p.hsn == null);
if (noHsn.length) {
  console.log(`\nCHƯA SUY ĐƯỢC HSN (${noHsn.length}) — Excel không có tỷ số TI, phải khai tay sau:`);
  for (const p of noHsn) console.log(`   ${p.pointCode}`);
}
if (clash.length) {
  console.log(`\nVA CHẠM (${clash.length}):`);
  for (const c of clash) console.log(`   ${c}`);
}

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }
if (clash.length) { console.error('\nDừng: còn va chạm.'); process.exit(1); }

/* -------------------------------- Ghi -------------------------------- */
const post = async (col, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${col}: ${JSON.stringify(j)}`);
  return j;
};
for (const p of plan) {
  const st = p.stationExists ?? await post('dm_station', {
    code: p.stationCode, zone: p.zone.id, customer: p.cus.id, ident: p.ident, sdm_kva: p.sdmKva });
  const pt = p.pointExists ?? await post('dm_point', {
    code: p.pointCode, line_name: p.pointCode, station: st.id, zone: p.zone.id, customer: p.cus.id,
    ident: '', sub_label: '', role: 'chinh', status: 'du_kien',
    /*
      `connection` là trường BẮT BUỘC. Suy được HSN thì theo HSN như app vẫn
      làm; chưa suy được thì ghi `gian_tiep` — trạm 320–560kVA chắc chắn đo qua
      TI, chỉ là Excel không ghi số TI ra.
    */
    connection: p.hsn != null ? connectionOfHsn(p.hsn) : 'gian_tiep',
    ...(p.hsn != null ? { hsn: p.hsn } : {}),
  });
  for (const it of p.items) {
    await post('dm_asset', {
      serial: it.serial, type: it.type, point: pt.id, active: true,
      // Chưa có ngày treo = vật tư dự kiến, còn nằm kho.
      ...(it.dateOn ? { date_on: it.dateOn, status: 'dang_treo' } : { status: 'kho' }),
      ...(it.primary != null ? { ratio_primary: it.primary, ratio_secondary: it.secondary } : {}),
    });
  }
  console.log(`OK  ${p.pointCode}  (+${p.items.length} vật tư)`);
}
