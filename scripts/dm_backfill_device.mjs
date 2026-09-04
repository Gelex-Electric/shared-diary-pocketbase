#!/usr/bin/env node
/**
 * Backfill `dm_device` từ `dm_asset` — bước 1 của việc tách THIẾT BỊ khỏi
 * LẦN LẮP (plan 2026-08-28).
 *
 * Gom các dòng `dm_asset` theo SỐ CHẾ TẠO: mỗi số No thành một thiết bị, rồi
 * nối ngược `dm_asset.device` về nó.
 *
 * Tỷ số lấy bằng ĐÚNG `pickRatio` của app (bundle qua esbuild), không chép lại
 * luật: ưu tiên cái đang hoạt động, cả bộ đã tháo thì lấy cái tháo sau cùng.
 * Chép tay luật này từng làm `TH.BQL.T2.160kVA.HANA` mất sạch HSN.
 *
 * Trạng thái suy ra, không đoán:
 *   - còn ít nhất một lần lắp ĐANG MỞ (chưa có ngày tháo) ⇒ `dang_treo`
 *   - không còn ⇒ `kho`   (kể cả vật tư đã tháo từ lâu — đúng vòng đời mới)
 *   - `thanh_ly` KHÔNG tự suy: đó là quyết định của người dùng.
 *
 * CHẠY THỬ mặc định — in ra rồi dừng. `--apply` mới ghi.
 * Chạy lại được: thiết bị đã có thì bỏ qua, chỉ nối `device` cho dòng còn thiếu.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_backfill_device.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--all');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/* Dùng ĐÚNG hàm chọn tỷ số của app. */
const tmp = mkdtempSync(join(tmpdir(), 'dm-'));
const out = join(tmp, 'hsn.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/dm/hsn.ts')], outfile: out,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const { pickRatio } = await import(pathToFileURL(out).href);
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
    if (r.status === 404) return null;
    o.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return o;
  }
};

const assets = await allOf('dm_asset');
const points = await allOf('dm_point');
const devices = await allOf('dm_device');
const codeOf = Object.fromEntries((points ?? []).map(p => [p.id, p.code || p.line_name || '—']));

if (devices === null) {
  console.log('CHÚ Ý: collection dm_device chưa tồn tại — chạy dm_schema_v13.mjs trước khi --apply.\n');
}
const haveDevice = new Map((devices ?? []).map(d => [String(d.serial).trim(), d]));

const ymd = (v) => String(v ?? '').slice(0, 10);
const N = (s) => String(s ?? '').trim();

/* --------------------------- Gom theo số No --------------------------- */
const bySerial = new Map();
const noSerial = [];
for (const a of assets) {
  const s = N(a.serial);
  if (!s) { noSerial.push(a); continue; }
  bySerial.set(s, [...(bySerial.get(s) ?? []), a]);
}

const plan = [];
const typeConflict = [];
const ratioConflict = [];
for (const [serial, rows] of bySerial) {
  const types = [...new Set(rows.map(r => r.type).filter(Boolean))];
  if (types.length > 1) {
    typeConflict.push({ serial, types, at: rows.map(r => codeOf[r.point] ?? '(kho)') });
  }
  /*
    Lần lắp ĐANG MỞ = ĐÃ CÓ ngày treo và CHƯA có ngày tháo.

    Phải đòi cả `date_on`. Bản đầu chỉ xét "chưa có ngày tháo", nên vật tư DỰ
    KIẾN (khai vào điểm đo nhưng chưa treo — 9 điểm SINTEC, 4 điểm
    TITAN/MATIN…) bị đếm là `dang_treo` trong khi chúng vẫn nằm trong kho.
    Ngày treo là mốc duy nhất chứng minh vật tư đã ra hiện trường.
  */
  const open = rows.filter(r => ymd(r.date_on) && !ymd(r.date_off));
  const planned = rows.filter(r => !ymd(r.date_on));
  const ratio = pickRatio(rows
    .filter(r => r.ratio_primary != null || r.ratio_secondary != null)
    .map(r => ({ primary: r.ratio_primary, secondary: r.ratio_secondary, active: !!r.active })));
  const kinds = [...new Set(rows
    .filter(r => r.ratio_primary != null)
    .map(r => `${r.ratio_primary}/${r.ratio_secondary}`))];
  if (kinds.length > 1) ratioConflict.push({ serial, kinds });

  const dates = rows.map(r => ymd(r.date_on)).filter(Boolean).sort();
  plan.push({
    serial,
    type: types[0] ?? 'KHAC',
    ratio_primary: ratio.primary ?? null,
    ratio_secondary: ratio.secondary ?? null,
    status: open.length ? 'dang_treo' : 'kho',
    date_in: dates[0] ?? '',
    rows, planned: planned.length, open: open.length,
    at: rows.map(r => codeOf[r.point] ?? '(không gắn)'),
    exists: haveDevice.get(serial),
  });
}

/* ------------------------------- In ra ------------------------------- */
const byStatus = plan.reduce((m, d) => ({ ...m, [d.status]: (m[d.status] ?? 0) + 1 }), {});
const byType = plan.reduce((m, d) => ({ ...m, [d.type]: (m[d.type] ?? 0) + 1 }), {});
const toCreate = plan.filter(d => !d.exists);
const linkNeeded = assets.filter(a => N(a.serial) && !a.device);

console.log(`dm_asset          : ${assets.length} bản ghi`);
console.log(`Số No khác nhau   : ${bySerial.size}`);
console.log(`dm_device đang có : ${devices === null ? '(chưa có collection)' : devices.length}`);
console.log(`\nSẼ TẠO thiết bị   : ${toCreate.length}`);
console.log(`SẼ NỐI dm_asset.device : ${linkNeeded.length} dòng`);
console.log(`\ntheo trạng thái   : ${JSON.stringify(byStatus)}`);
console.log(`theo loại         : ${JSON.stringify(byType)}`);

/*
  Trong đám `kho`, tách riêng loại "đã khai vào một điểm đo nhưng chưa treo".
  Bước 3 phải quyết định chỗ đứng cho nó: dòng dm_asset không ngày treo, hay
  một trường `hold_point` trên chính thiết bị.
*/
const plannedOnly = plan.filter(d => d.status === 'kho' && d.planned > 0 && d.open === 0);
const trulyIdle = plan.filter(d => d.status === 'kho' && d.planned === 0);
console.log(`\ntrong ${byStatus.kho ?? 0} cái ở KHO:`);
console.log(`   ${plannedOnly.length} đang GIỮ CHỖ cho một điểm đo (khai rồi, chưa treo)`);
console.log(`   ${trulyIdle.length} đã tháo khỏi mọi điểm đo, nằm không`);

const multi = plan.filter(d => d.rows.length > 1);
console.log(`\nThiết bị có NHIỀU lần lắp : ${multi.length}`);
for (const d of multi.slice(0, VERBOSE ? multi.length : 10)) {
  console.log(`   ${d.serial.padEnd(20)} ${d.type.padEnd(7)} ${d.rows.length} lần: ${d.at.join(' → ')}`);
}
if (!VERBOSE && multi.length > 10) console.log(`   … còn ${multi.length - 10} cái (thêm --all để xem hết)`);

if (noSerial.length) {
  console.log(`\nDòng dm_asset KHÔNG có số No : ${noSerial.length} — sẽ KHÔNG nối được thiết bị nào`);
  for (const a of noSerial) console.log(`   id=${a.id} ${a.type} @ ${codeOf[a.point] ?? '—'}`);
}
if (typeConflict.length) {
  console.log(`\n⚠ CÙNG SỐ NO KHÁC LOẠI : ${typeConflict.length} — phải xử tay, script lấy loại đầu tiên`);
  for (const c of typeConflict) console.log(`   ${c.serial}: ${c.types.join(' ≠ ')}  @ ${c.at.join(', ')}`);
}
if (ratioConflict.length) {
  console.log(`\n⚠ CÙNG SỐ NO KHÁC TỶ SỐ : ${ratioConflict.length} — pickRatio chọn cái đang hoạt động`);
  for (const c of ratioConflict) console.log(`   ${c.serial}: ${c.kinds.join(' ≠ ')}`);
}

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }
if (devices === null) { console.error('\nDừng: chưa có dm_device. Chạy dm_schema_v13.mjs trước.'); process.exit(1); }

/* -------------------------------- Ghi -------------------------------- */
const req = async (method, path, body) => {
  const r = await fetch(`${PB}${path}`, {
    method, headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(j)}`);
  return j;
};

let nDev = 0, nLink = 0;
for (const d of plan) {
  const dev = d.exists ?? await req('POST', '/api/collections/dm_device/records', {
    serial: d.serial, type: d.type, status: d.status,
    ...(d.ratio_primary != null ? { ratio_primary: d.ratio_primary } : {}),
    ...(d.ratio_secondary != null ? { ratio_secondary: d.ratio_secondary } : {}),
    ...(d.date_in ? { date_in: d.date_in } : {}),
  });
  if (!d.exists) nDev++;
  for (const a of d.rows) {
    if (a.device === dev.id) continue;
    await req('PATCH', `/api/collections/dm_asset/records/${a.id}`, { device: dev.id });
    nLink++;
  }
  if (nDev % 50 === 0 && nDev) console.log(`   … ${nDev} thiết bị`);
}
console.log(`\nĐã tạo ${nDev} thiết bị, nối ${nLink} dòng dm_asset.`);
