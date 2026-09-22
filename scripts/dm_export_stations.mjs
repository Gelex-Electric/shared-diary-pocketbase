#!/usr/bin/env node
/**
 * Xuất Excel DANH SÁCH TRẠM BIẾN ÁP từ PocketBase (`dm_station`).
 *
 * CHỈ ĐỌC. Gọi mạng bằng `curl` chứ không dùng fetch của Node: mạng công ty
 * chèn cert (`SELF_SIGNED_CERT_IN_CHAIN`) nên Node không gọi thẳng PB được,
 * còn curl thì tin trust store của Windows.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_export_stations.mjs [ra.xlsx]
 */
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = new Date().toISOString().slice(0, 10);
const OUT = process.argv.find(a => a.endsWith('.xlsx'))
  || join(ROOT, '..', `Danh-sach-tram-bien-ap-${TODAY}.xlsx`);
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

/**
 * Cấp điện áp KHÔNG có trong `dm_station` (schema dừng ở `sdm_kva`), nên tên máy
 * biến áp ghép từ dung lượng + tỷ số điện áp mặc định dưới đây. Trạm khác cấp
 * thì chạy lại với `--dien-ap=35/0,4kV`.
 */
const RATIO = (process.argv.find(x => x.startsWith('--dien-ap=')) ?? '').slice(10) || '22/0,4kV';

/** 2500 → "MBA 2500kVA 22/0,4kV". Số lẻ viết dấu phẩy kiểu Việt. */
const tenMba = (kva) => (kva == null || kva === '')
  ? '' : `MBA ${String(kva).replace('.', ',')}kVA ${RATIO}`;

const tmp = mkdtempSync(join(tmpdir(), 'tram-'));
const curl = (args) => JSON.parse(execFileSync('curl', ['-s', '-m', '60', ...args], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}));

/* Đăng nhập: mật khẩu đi qua FILE, không qua dòng lệnh. */
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({
  identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD,
}));
const auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
  '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
rmSync(tmp, { recursive: true, force: true });
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }

/** Lấy HẾT bản ghi — một trang 500 là thiếu im lặng khi collection lớn hơn. */
const allOf = (col, sort = '') => {
  const o = [];
  for (let p = 1; ; p++) {
    const r = curl([`${PB}/api/collections/${col}/records?perPage=500&page=${p}${sort ? `&sort=${sort}` : ''}`,
      '-H', `Authorization: ${auth.token}`]);
    o.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return o;
  }
};

const [stations, zones, customers, points] =
  ['dm_station', 'dm_zone', 'dm_customer', 'dm_point'].map(c => allOf(c));

const zoneById = Object.fromEntries(zones.map(z => [z.id, z]));
const cusById = Object.fromEntries(customers.map(c => [c.id, c]));
const pointsOf = {};
for (const p of points) (pointsOf[p.station] ??= []).push(p);

/**
 * GOM theo (khách hàng, dung lượng): cùng một khách mà có nhiều trạm cùng kVA
 * thì chỉ một dòng, cột `Số lượng` đếm số trạm. Mã trạm và định danh của cả
 * nhóm nối bằng dấu phẩy để vẫn tra ngược được từng trạm.
 */
const groups = new Map();
for (const s of stations) {
  const key = `${s.customer ?? ''}|${s.sdm_kva ?? ''}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(s);
}

const rows = [...groups.values()]
  .map(g => g.sort((a, b) => String(a.code).localeCompare(String(b.code), 'vi')))
  .sort((a, b) => String(a[0].code).localeCompare(String(b[0].code), 'vi'))
  .map((g, i) => {
    const s = g[0];
    const ps = g.flatMap(x => pointsOf[x.id] ?? []);
    return {
      'STT': i + 1,
      'KCN': zoneById[s.zone]?.name ?? '',
      'Khách hàng': cusById[s.customer]?.name ?? '',
      'Mã KH': cusById[s.customer]?.mkh ?? '',
      'Máy biến áp': tenMba(s.sdm_kva),
      'Số lượng': g.length,
      'Sđm (kVA)': s.sdm_kva ?? '',
      'Mã trạm': g.map(x => x.code ?? '').join(', '),
      'Định danh': g.map(x => x.ident ?? '').filter(Boolean).join(', '),
      'Số điểm đo': ps.length,
      'Điểm đo chính': ps.filter(p => p.role === 'chinh').length,
      'Ghi chú': g.map(x => x.note ?? '').filter(Boolean).join(' | '),
    };
  });

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [6, 16, 34, 14, 26, 10, 10, 34, 12, 11, 13, 30].map(w => ({ wch: w }));
ws['!autofilter'] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(ws['!ref'])) };
ws['!freeze'] = { xSplit: 0, ySplit: 1 };
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Trạm biến áp');
XLSX.writeFile(wb, OUT);
console.log(`${stations.length} trạm gom thành ${rows.length} dòng → ${OUT}`);
