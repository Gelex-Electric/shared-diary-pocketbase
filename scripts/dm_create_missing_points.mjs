#!/usr/bin/env node
/**
 * Tạo các ĐIỂM ĐO Excel có mà PocketBase chưa có, rồi gắn thiết bị đã nạp ở
 * `dm_import_devices.mjs` vào chúng.
 *
 * Vì sao tách khỏi script nạp thiết bị: nạp thiết bị là việc an toàn (chỉ thêm
 * bản ghi vào kho), còn tạo điểm đo thì đụng vào cây danh mục và sinh mã theo
 * quy ước — sai một mã là lệch `LINE_NAME` bên HES. Hai mức rủi ro khác nhau
 * thì không gộp một nút bấm.
 *
 * Toàn bộ đều "Chưa đóng điện" bên Excel và sổ chỉ ghi "Nhập kho", nên:
 *   - KHÔNG điền ngày treo → vật tư là DỰ KIẾN, điểm đo ra trạng thái Dự kiến.
 *   - HSN vẫn suy được từ tỷ số TI (luật 27/08/2026: cả bộ còn dự kiến thì lấy
 *     tỷ số của chính các dòng dự kiến).
 *
 * CHẠY THỬ mặc định. `--apply` mới ghi. Chạy lại được.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_create_missing_points.mjs
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

/**
 * Danh sách chốt tay, KHÔNG suy từ Excel.
 *
 * Mã điểm đo là `LINE_NAME` bên HES nên không để script tự đoán chủ trạm hay
 * quan hệ chính/phụ. `excel` là khoá tra ngược vào sổ giao dịch để lấy vật tư.
 */
const WANT = [
  { excel: 'YM.TITAN.TRRBW-1.1500kVA', mkh: 'KCNYM-005', ident: 'TRRBW-1', sdmKva: 1500 },
  { excel: 'YM.TITAN.TRRBW-2.2000kVA', mkh: 'KCNYM-005', ident: 'TRRBW-2', sdmKva: 2000 },
  { excel: 'YM.TITAN.TRRBW-3.2000kVA', mkh: 'KCNYM-005', ident: 'TRRBW-3', sdmKva: 2000 },
  { excel: 'YM.SUNRISE.T1.2500kVA', mkh: 'KCNYM-036', ident: 'T1', sdmKva: 2500 },
  { excel: 'YM.SUNRISE.T2.2500kVA', mkh: 'KCNYM-036', ident: 'T2', sdmKva: 2500 },
  { excel: 'YM.KIMTIN.T3.2500kVA', mkh: 'KCNYM-014', ident: 'T3', sdmKva: 2500 },
  { excel: 'YM.JILI.T2.800kVA', mkh: 'KCNYM-003', ident: 'T2', sdmKva: 800 },
  // Hai điểm đo PHỤ của trạm NX6 — PB đã có P1, P2 và điểm đo chính.
  {
    excel: 'TTI.TITAN.NX6.2000kVA.P3', mkh: 'KCNTTI-007', ident: 'NX6', sdmKva: 2000,
    sub: 'P3', parentCode: 'TTI.TITAN.NX6.2000kVA',
  },
  {
    excel: 'TTI.TITAN.NX6.2000kVA.P4', mkh: 'KCNTTI-007', ident: 'NX6', sdmKva: 2000,
    sub: 'P4', parentCode: 'TTI.TITAN.NX6.2000kVA',
  },
];

/**
 * Vật tư lẻ gắn vào điểm đo ĐÃ CÓ nhưng script trước từ chối vì mã hai bên
 * khác nhau (điểm đo đã đổi tên). Đối chiếu tay rồi mới ghi vào đây.
 */
const EXTRA = [
  {
    serial: '869914061460764', pointCode: '03.ARCANA.T1.1600kVA',
    why: 'Excel còn gọi là 03.LOGOS.T3.1600kVA.ARCANA.T1 — PB đã đổi tên điểm đo',
  },
];

/* Dùng ĐÚNG hàm sinh mã và tính HSN của app. */
const tmp = mkdtempSync(join(tmpdir(), 'dm-'));
const load = async (rel, name) => {
  const f = join(tmp, `${name}.mjs`);
  await build({ entryPoints: [join(ROOT, rel)], outfile: f, bundle: true,
    format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(f).href);
};
const { buildStationCode, buildPointCode } = await load('src/lib/dm/naming.ts', 'naming');
const { deriveHsn, pickRatio, connectionOfHsn } = await load('src/lib/dm/hsn.ts', 'hsn');
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

const N = (s) => String(s ?? '').replace(/^'+/, '').trim().toUpperCase();
const devBySerial = new Map(devices.map(d => [N(d.serial), d]));
const assetSerials = new Set(assets.filter(a => a.point).map(a => N(a.serial)));

/* -------------------------------- Excel -------------------------------- */
const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const xTrans = XLSX.utils.sheet_to_json(wb.Sheets['Quản lý giao dịch'], { defval: null });
/** Số No mà sổ gán cho một điểm đo Excel. */
const serialsOf = (dd) => [...new Set(xTrans
  .filter(t => String(t.DDDK ?? '').trim() === dd)
  .map(t => N(t.ID)).filter(Boolean))];

const plan = [];
for (const w of WANT) {
  const cus = customers.find(c => c.mkh === w.mkh);
  if (!cus) { console.error(`Không có khách hàng ${w.mkh}`); process.exit(1); }
  const zone = zones.find(z => z.id === cus.zone);
  if (!zone) { console.error(`Khách ${w.mkh} chưa gắn KCN`); process.exit(1); }

  const parts = { zoneCode: zone.code, customerShortName: cus.short_name ?? '', ident: w.ident, sdmKva: w.sdmKva };
  const stationCode = buildStationCode(parts);
  const pointCode = buildPointCode({ ...parts, isSub: !!w.sub, subLabel: w.sub });

  const parent = w.parentCode ? points.find(p => p.code === w.parentCode) : undefined;
  if (w.parentCode && !parent) { console.error(`Không thấy điểm đo cha ${w.parentCode}`); process.exit(1); }

  // Thiết bị của điểm đo này — đã nằm trong kho, chưa gắn đâu.
  const items = serialsOf(w.excel)
    .map(s => devBySerial.get(s))
    .filter(Boolean)
    .filter(d => !assetSerials.has(N(d.serial)));

  const ratio = (type) => pickRatio(items
    .filter(x => x.type === type && x.ratio_primary != null)
    .map(x => ({ primary: x.ratio_primary, secondary: x.ratio_secondary, active: true })));
  const hasTi = items.some(x => x.type === 'TI');
  const hsn = hasTi ? deriveHsn({ hasTi, ti: ratio('TI'), tu: ratio('TU') }) : null;

  plan.push({
    ...w, cus, zone, stationCode, pointCode, parent, items, hsn,
    stationExists: stations.find(s => s.code === stationCode),
    pointExists: points.find(p => p.code === pointCode),
  });
}

/* ------------------------------- In ra ------------------------------- */
for (const p of plan) {
  console.log(`\n${p.excel}   [${p.cus.mkh}]`);
  console.log(`  TRẠM  ${p.stationCode.padEnd(30)} ${p.stationExists ? 'đã có' : 'TẠO MỚI'}`);
  console.log(`  ĐIỂM  ${p.pointCode.padEnd(30)} ${p.pointExists ? 'đã có' : 'TẠO MỚI'}`
    + ` · ${p.sub ? `phụ của ${p.parentCode}` : 'chính'}`
    + ` · HSN ${p.hsn ?? 'chưa suy được'} · dự kiến`);
  for (const it of p.items) {
    console.log(`     ${String(it.type).padEnd(7)} ${String(it.serial).padEnd(20)}`
      + `${it.ratio_primary != null ? ` ${it.ratio_primary}/${it.ratio_secondary}` : ''}`);
  }
  if (!p.items.length) console.log('     (không có thiết bị rảnh nào)');
}
const extra = EXTRA.map(e => ({
  ...e,
  dev: devBySerial.get(N(e.serial)),
  point: points.find(p => p.code === e.pointCode),
  done: assetSerials.has(N(e.serial)),
}));
if (extra.length) {
  console.log('\n--- Vật tư lẻ gắn vào điểm đo đã có ---');
  for (const e of extra) {
    console.log(`   ${e.serial} → ${e.pointCode} `
      + `${e.done ? '(đã gắn rồi)' : e.dev && e.point ? '' : '⚠ THIẾU thiết bị hoặc điểm đo'}`);
    console.log(`      ${e.why}`);
  }
}
const nS = plan.filter(p => !p.stationExists).length;
const nP = plan.filter(p => !p.pointExists).length;
const nA = plan.reduce((n, p) => n + p.items.length, 0) + extra.filter(e => !e.done && e.dev && e.point).length;
console.log(`\nSẼ TẠO: ${nS} trạm · ${nP} điểm đo · ${nA} lần lắp (đều KHÔNG có ngày treo)`);

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }

/* -------------------------------- Ghi -------------------------------- */
const post = async (col, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${col}: ${JSON.stringify(j)}`);
  return j;
};
const patch = async (col, id, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records/${id}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${col}/${id}: ${JSON.stringify(await r.json())}`);
};

/** Gắn một thiết bị vào điểm đo dưới dạng GIỮ CHỖ (chưa treo). */
const holdInto = async (dev, pointId) => {
  await post('dm_asset', {
    serial: dev.serial, type: dev.type, device: dev.id, point: pointId,
    ratio_primary: dev.ratio_primary, ratio_secondary: dev.ratio_secondary,
    date_on: '', active: true, status: 'kho',
  });
  await patch('dm_device', dev.id, { hold_point: pointId });
};

for (const p of plan) {
  const st = p.stationExists ?? await post('dm_station', {
    code: p.stationCode, zone: p.zone.id, customer: p.cus.id,
    ident: p.ident, sdm_kva: p.sdmKva,
  });
  const pt = p.pointExists ?? await post('dm_point', {
    code: p.pointCode, line_name: p.pointCode, station: st.id, zone: p.zone.id, customer: p.cus.id,
    ident: '', sub_label: p.sub ?? '', role: p.sub ? 'phu' : 'chinh',
    ...(p.parent ? { parent_point: p.parent.id } : {}),
    connection: p.hsn != null ? connectionOfHsn(p.hsn) : 'gian_tiep',
    ...(p.hsn != null ? { hsn: p.hsn } : {}),
    status: 'du_kien',
    note: `Excel: ${p.excel}`,
  });
  for (const it of p.items) await holdInto(it, pt.id);
  console.log(`OK  ${p.pointCode}  (+${p.items.length} vật tư)`);
}
for (const e of extra) {
  if (e.done || !e.dev || !e.point) continue;
  await holdInto(e.dev, e.point.id);
  console.log(`OK  ${e.serial} → ${e.pointCode}`);
}
