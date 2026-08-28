#!/usr/bin/env node
/**
 * Đếm ĐIỂM ĐO CHƯA CÓ HSN trên dữ liệu thật, và cho biết cái nào suy được HSN
 * từ tỷ số TI/TU đã khai (kể cả vật tư dự kiến — luật mới 27/08/2026).
 *
 * CHỈ ĐỌC. Không ghi gì.
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_hsn_missing.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

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
const { deriveHsn, pickRatio } = await load('src/lib/dm/hsn.ts', 'hsn');

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

/** Lấy HẾT bản ghi — `dm_asset` đã vượt 500, một trang là thiếu im lặng. */
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

let missing = 0, fixable = 0, stuck = 0;
const lines = [];
for (const p of points) {
  if (p.hsn != null && p.hsn !== 0 && p.hsn !== '') continue;
  missing++;
  const rows = byPoint.get(p.id) ?? [];
  const hung = rows.filter(r => (r.date_on ?? '').trim());
  const use = hung.length ? hung : rows;
  const hsn = deriveHsn({ hasTi: use.some(r => r.type === 'TI'), ti: ratioSet(use, 'TI'), tu: ratioSet(use, 'TU') });
  if (hsn != null && hsn > 0) { fixable++; lines.push(`  suy được ${String(hsn).padStart(8)}  ${p.code}${hung.length ? '' : '  (dự kiến)'}`); }
  else { stuck++; lines.push(`  CHƯA SUY ĐƯỢC        ${p.code}  (${rows.length} vật tư)`); }
}

console.log(`Tổng điểm đo: ${points.length}`);
console.log(`Chưa có HSN : ${missing}  →  suy được: ${fixable}, phải khai tay: ${stuck}`);
console.log(lines.sort().join('\n'));
