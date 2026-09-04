#!/usr/bin/env node
/**
 * Kiểm chứng luật đối chiếu SẢN LƯỢNG PHỤ TRỪ trên DỮ LIỆU THẬT.
 *
 * Bundle thẳng `src/lib/dm/subDeduct.ts` + `lifecycle.ts` bằng esbuild rồi gọi
 * vào — chạy đúng code sẽ ship, không chép lại logic.
 *
 * CHỈ ĐỌC.  PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_sub_deduct.mjs
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

const S = await load('src/lib/dm/subDeduct.ts', 'sub');
const L = await load('src/lib/dm/lifecycle.ts', 'lc');

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };
const get = async p => (await (await fetch(`${PB}/api/collections/${p}`, { headers: H })).json()).items ?? [];

/**
 * Lấy HẾT bản ghi của một collection, CÓ PHÂN TRANG.
 *
 * `dm_asset` đã vượt 500 bản ghi, lấy đúng một trang thì thiếu im lặng — đã
 * làm script này báo "không có hóa đơn" cho điểm đo phụ mà thật ra có đủ.
 */
const allOf = async col => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await (await fetch(`${PB}/api/collections/${col}/records?perPage=500&page=${page}`, { headers: H })).json();
    out.push(...(r.items ?? []));
    if (page >= (r.totalPages ?? 1)) return out;
  }
};

const points = await allOf('dm_point');
const assets = await allOf('dm_asset');
const since = L.recentSince(new Date());

const mains = S.buildMainsWithSubs(points, assets);

console.log(`Mốc 40 ngày: từ ${since}`);
console.log(`Điểm đo chính ĐANG VẬN HÀNH và có điểm đo phụ đang vận hành: ${mains.length}\n`);

const all = [...new Set(mains.flatMap(m => [...m.serials, ...m.subs.flatMap(s => s.serials)]))];
const inv = [];
for (let i = 0; i < all.length; i += 40) {
  const or = all.slice(i, i + 40).map(s => `SCT="${s}"`).join('||');
  /*
    Lấy từ ĐẦU THÁNG chứa mốc 40 ngày, giống `invoicesUsageOf` bên app.
    Cắt giữa tháng là so nửa tháng của điểm chính với cả tháng của điểm phụ —
    ca `TH.BQL.T2.160kVA` tháng 07/2026 báo lệch 1840 kWh hoàn toàn giả.
  */
  const from = `${since.slice(0, 7)}-01`;
  inv.push(...await get(`invoice/records?perPage=500&filter=${encodeURIComponent(`(${or}) && EndDate >= "${from} 00:00:00.000Z"`)}`));
}
console.log(`Hóa đơn trong phạm vi: ${inv.length} (của ${all.length} số công tơ)\n`);

let n = 0, checked = 0;
for (const m of mains) {
  const periods = inv.filter(i => m.serials.includes(i.SCT) && (i.LoaiHD ?? 'HC') === 'HC');
  checked += periods.length;
  const issues = S.checkSubDeduction(m, inv, since);
  if (!issues.length) {
    if (periods.length) console.log(`✓ ${m.code}  (${m.subs.length} điểm phụ · ${periods.length} kỳ khớp)`);
    else console.log(`· ${m.code}  không có hóa đơn trong 40 ngày`);
    continue;
  }
  for (const x of issues) { n++; console.log(`✗ ${x.code}  [${x.period}]  ${x.note}`); }
}
console.log(`\nĐã soi ${checked} kỳ hóa đơn · ${n} kỳ có cảnh báo`);
