#!/usr/bin/env node
/**
 * Sửa HSN của các ĐIỂM ĐO DỰ KIẾN đang bị lưu nhầm thành 1.
 *
 * Nguyên nhân: trước 27/08/2026, `hasTi` chỉ xét vật tư ĐÃ TREO. Điểm đo mới
 * khai chưa có ngày treo nào thì `hasTi = false`, `deriveHsn` trả về 1 (đo
 * thẳng) và con số đó được ghi xuống `dm_point.hsn` — dù đã khai đủ 3 TI. HSN
 * nhân thẳng vào chỉ số HES nên sai 1 với 600 là sai toàn bộ sản lượng.
 *
 * CHỈ ghi `hsn` và `connection`, CHỈ cho điểm đo chưa có vật tư nào được treo,
 * và CHỈ khi suy ra được số khác 1. Không đụng bất cứ cột nào khác.
 *
 * Mặc định CHẠY THỬ, in ra rồi dừng. Thêm `--apply` mới ghi thật:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_fix_planned_hsn.mjs
 *   ... node scripts/dm_fix_planned_hsn.mjs --apply
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APPLY = process.argv.includes('--apply');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

const load = async (rel, name) => {
  const dir = mkdtempSync(join(tmpdir(), 'dm-'));
  const out = join(dir, `${name}.mjs`);
  await build({ entryPoints: [join(ROOT, rel)], outfile: out, bundle: true,
    format: 'esm', platform: 'node', logLevel: 'silent' });
  const mod = await import(pathToFileURL(out).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
};
// Dùng ĐÚNG hàm app đang chạy, không chép lại công thức.
const { deriveHsn, pickRatio, connectionOfHsn } = await load('src/lib/dm/hsn.ts', 'hsn');

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

/** Lấy HẾT bản ghi — `dm_asset` đã vượt 500, lấy một trang là thiếu im lặng. */
const allOf = async (col) => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await (await fetch(
      `${PB}/api/collections/${col}/records?perPage=500&page=${page}`, { headers: H })).json();
    out.push(...(r.items ?? []));
    if (page >= (r.totalPages ?? 1)) return out;
  }
};

const points = await allOf('dm_point');
const assets = await allOf('dm_asset');
const byPoint = new Map();
for (const a of assets) {
  if (!a.point) continue;
  byPoint.set(a.point, [...(byPoint.get(a.point) ?? []), a]);
}
const ratioSet = (rows, type) => pickRatio(rows
  .filter(r => r.type === type && (r.ratio_primary != null || r.ratio_secondary != null))
  .map(r => ({ primary: r.ratio_primary, secondary: r.ratio_secondary, active: r.active })));

const todo = [];
for (const p of points) {
  const rows = byPoint.get(p.id) ?? [];
  // Chỉ điểm đo còn DỰ KIẾN hoàn toàn — có dòng nào đã treo là HSN đã đúng.
  if (rows.some(r => (r.date_on ?? '').trim())) continue;
  const hsn = deriveHsn({
    hasTi: rows.some(r => r.type === 'TI'),
    ti: ratioSet(rows, 'TI'), tu: ratioSet(rows, 'TU'),
  });
  if (hsn == null || hsn <= 0 || hsn === p.hsn) continue;
  todo.push({ p, hsn });
}

for (const { p, hsn } of todo) {
  console.log(`${p.code}: HSN ${p.hsn} → ${hsn}  (${(byPoint.get(p.id) ?? []).filter(r => r.type === 'TI').length} TI)`);
}
console.log(`\n${todo.length} điểm đo cần sửa.`);

if (!APPLY) { console.log('CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }

for (const { p, hsn } of todo) {
  const res = await fetch(`${PB}/api/collections/dm_point/records/${p.id}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hsn, connection: connectionOfHsn(hsn) }),
  });
  console.log(`${res.ok ? 'OK  ' : 'LỖI '} ${p.code} → ${hsn}`);
}
