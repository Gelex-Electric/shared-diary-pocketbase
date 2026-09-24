#!/usr/bin/env node
/**
 * T0 của `plans/2026-09-23-tai-khoi-dong-ton-that-tu-chi-so.md`.
 *
 * Soát Danh mục xem có ĐỦ dữ liệu để tính tổn thất MBA từ PocketBase không, TRƯỚC
 * khi viết lõi tính. Câu hỏi cần trả lời: đổi nguồn từ `mba_info.csv`+`metterinfo.csv`
 * sang PB thì được thêm bao nhiêu trạm, MẤT bao nhiêu trạm.
 *
 * CHỈ ĐỌC. Không ghi PocketBase, không ghi file nào.
 *
 * Gọi mạng bằng `curl` chứ không dùng fetch của Node: mạng công ty chặn cert của
 * Node, còn curl tin trust store của Windows (bài học `dm_export_stations.mjs` 17/09).
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- \
 *     node scripts/dm_check_station_params.mjs
 *
 * Hoặc tự truyền: PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_check_station_params.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const MBA_PATH = process.env.MBA_PATH || 'public/mba_info.csv';
const METTER_PATH = process.env.METTERINFO_PATH || 'public/metterinfo.csv';

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Thiếu tài khoản PocketBase. Chạy qua `railway run`, hoặc truyền '
    + 'PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.');
  process.exit(1);
}

const curl = (args) => JSON.parse(execFileSync('curl', ['-s', '-m', '60', ...args], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
}));

/* Đăng nhập: mật khẩu đi qua FILE tạm, không qua dòng lệnh (dòng lệnh lộ trong ps). */
const tmp = mkdtempSync(join(tmpdir(), 'dmchk-'));
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  for (const coll of ['_superusers', 'users']) {
    auth = curl(['-X', 'POST', `${PB}/api/collections/${coll}/auth-with-password`,
      '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
    if (auth?.token) break;
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (!auth?.token) {
  console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200));
  process.exit(1);
}

/** Lấy HẾT bản ghi — một trang 500 là thiếu im lặng khi collection lớn hơn. */
const allOf = (col) => {
  const o = [];
  for (let p = 1; ; p++) {
    const r = curl([`${PB}/api/collections/${col}/records?perPage=500&page=${p}`,
      '-H', `Authorization: ${auth.token}`]);
    if (r.items == null) {
      console.error(`Không đọc được ${col}:`, JSON.stringify(r).slice(0, 200));
      process.exit(1);
    }
    o.push(...r.items);
    if (p >= (r.totalPages ?? 1)) return o;
  }
};

const [stations, points, assets, zones] =
  ['dm_station', 'dm_point', 'dm_asset', 'dm_zone'].map(allOf);

const ymd = (v) => String(v || '').slice(0, 10);
const zoneName = new Map(zones.map(z => [z.id, z.name]));
const num = (v) => (v == null || v === '' ? null : Number(v));

/* Công tơ ĐANG TREO = có ngày treo, chưa có ngày tháo (chặt hơn cờ active). */
const liveByPoint = new Map();
for (const a of assets) {
  if (a.type !== 'CONGTO' || !a.point) continue;
  if (!ymd(a.date_on) || ymd(a.date_off)) continue;
  if (!liveByPoint.has(a.point)) liveByPoint.set(a.point, []);
  liveByPoint.get(a.point).push(a);
}

const pointsOfStation = new Map();
for (const p of points) {
  if (!p.station) continue;
  if (!pointsOfStation.has(p.station)) pointsOfStation.set(p.station, []);
  pointsOfStation.get(p.station).push(p);
}

/* ---------- phân loại từng trạm theo đúng 4 lý do trong plan §7.4 ---------- */
const REASONS = ['TINH_DUOC', 'THIEU_THONG_SO', 'KHONG_CO_CONG_TO', 'THIEU_HSN'];
const bucket = Object.fromEntries(REASONS.map(r => [r, []]));

for (const s of stations) {
  const zone = zoneName.get(s.zone) || '—';
  const label = `${s.code || '(chưa có mã)'}  [${zone}]`;
  const mains = (pointsOfStation.get(s.id) || [])
    .filter(p => p.role === 'chinh' && p.status === 'active');
  const withMeter = mains.filter(p => liveByPoint.has(p.id));

  const missParam = ['sdm_kva', 'p0_w', 'pk_w'].filter(f => num(s[f]) == null || num(s[f]) === 0);

  if (withMeter.length === 0) {
    bucket.KHONG_CO_CONG_TO.push(`${label}  (${mains.length} điểm đo chính active, 0 có công tơ treo)`);
  } else if (missParam.length) {
    bucket.THIEU_THONG_SO.push(`${label}  thiếu: ${missParam.join(', ')}`);
  } else if (withMeter.some(p => num(p.hsn) == null)) {
    const bad = withMeter.filter(p => num(p.hsn) == null).map(p => p.code || p.line_name || p.id);
    bucket.THIEU_HSN.push(`${label}  điểm đo chưa có HSN: ${bad.join(', ')}`);
  } else {
    bucket.TINH_DUOC.push(label);
  }
}

/* ---------- so với hai file CSV đang là nguồn cũ ---------- */
const normCode = (x) => String(x || '').replace(/\s+/g, '').toUpperCase();

let mbaCodes = new Set();
if (fs.existsSync(MBA_PATH)) {
  const lines = fs.readFileSync(MBA_PATH, 'utf8').split(/\r?\n/).filter(x => x.trim());
  mbaCodes = new Set(lines.slice(1).map(l => normCode(l.split(/[;,]/)[0])));
}

let csvStationCodes = new Set();
if (fs.existsSync(METTER_PATH)) {
  const lines = fs.readFileSync(METTER_PATH, 'utf8').split(/\r?\n/).filter(x => x.trim());
  const H = lines[0].split(',');
  const iC = H.indexOf('CODE'), iR = H.indexOf('ROLE'), iS = H.indexOf('STATUS');
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    if (c[iR] === 'chinh' && c[iS] === 'Yes' && c[iC]) csvStationCodes.add(normCode(c[iC]));
  }
}

const pbOk = new Set(bucket.TINH_DUOC.map(x => normCode(x.split('  [')[0])));
const onlyPb = [...pbOk].filter(c => !csvStationCodes.has(c));
const onlyCsv = [...csvStationCodes].filter(c => !pbOk.has(c));

/* ---------- đối chiếu THEO SERIAL CÔNG TƠ ----------
   So mã trạm giữa hai nguồn là vô nghĩa: HES đặt tên tự do, PB sinh mã theo
   `buildStationCode`. Cùng một trạm ra hai chuỗi khác nhau (TH.BEBRIGHT vs
   TH.BE-BRIGHT). Serial công tơ thì DUY NHẤT ở cả hai bên — đối chiếu theo nó
   mới biết đổi nguồn có thật sự mất trạm nào không. */
const pointById = new Map(points.map(p => [p.id, p]));
const stationById = new Map(stations.map(s => [s.id, s]));
const N = (v) => String(v || '').trim();

/** serial công tơ đang treo → { point, station } */
const liveMeterInfo = new Map();
for (const [pid, list] of liveByPoint) {
  const p = pointById.get(pid);
  for (const a of list) liveMeterInfo.set(N(a.serial), { point: p, station: stationById.get(p?.station) });
}

const csvMainMeters = [];
if (fs.existsSync(METTER_PATH)) {
  const lines = fs.readFileSync(METTER_PATH, 'utf8').split(/\r?\n/).filter(x => x.trim());
  const H = lines[0].split(',');
  const iM = H.indexOf('METER_NO'), iR = H.indexOf('ROLE'), iS = H.indexOf('STATUS'),
        iC = H.indexOf('CODE'), iN = H.indexOf('CUSTOMER_NAME');
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    if (c[iR] === 'chinh' && c[iS] === 'Yes') {
      csvMainMeters.push({ serial: N(c[iM]), code: N(c[iC]), name: N(c[iN]).slice(0, 34) });
    }
  }
}

const meterVerdict = { OK: [], KHONG_CO_TRONG_PB: [], PB_KHONG_TREO: [], DIEM_DO_KHONG_ACTIVE: [], TRAM_THIEU_THONG_SO: [] };
for (const m of csvMainMeters) {
  const info = liveMeterInfo.get(m.serial);
  if (!info) {
    const known = assets.some(a => N(a.serial) === m.serial);
    (known ? meterVerdict.PB_KHONG_TREO : meterVerdict.KHONG_CO_TRONG_PB)
      .push(`${m.serial}  ${m.code}  ${m.name}`);
    continue;
  }
  const p = info.point, s = info.station;
  if (p?.role !== 'chinh' || p?.status !== 'active') {
    meterVerdict.DIEM_DO_KHONG_ACTIVE.push(`${m.serial}  ${m.code}  role=${p?.role} status=${p?.status || '(trống)'}`);
  } else if (['sdm_kva', 'p0_w', 'pk_w'].some(f => num(s?.[f]) == null || num(s?.[f]) === 0)) {
    meterVerdict.TRAM_THIEU_THONG_SO.push(`${m.serial}  ${m.code} → PB ${s?.code}`);
  } else {
    meterVerdict.OK.push(m.serial);
  }
}

/* ---------------------------- báo cáo ---------------------------- */
const line = (n = 74) => console.log('─'.repeat(n));
console.log(`\nSOÁT DANH MỤC CHO PHẦN TỔN THẤT — ${PB}`);
line();
console.log(`dm_station ${stations.length} · dm_point ${points.length} · `
  + `dm_asset ${assets.length} (công tơ đang treo: ${[...liveByPoint.values()].flat().length})`);
line();

for (const r of REASONS) {
  console.log(`\n${r}: ${bucket[r].length} trạm`);
  if (r !== 'TINH_DUOC') bucket[r].forEach(x => console.log('   ' + x));
}

line();
console.log(`\nKẾT LUẬN: tính được ${bucket.TINH_DUOC.length}/${stations.length} trạm.`);
console.log(`\nSo với nguồn CŨ:`);
console.log(`  mba_info.csv khai              : ${mbaCodes.size} trạm`);
console.log(`  metterinfo (chinh+Yes) có CODE : ${csvStationCodes.size} trạm`);
console.log(`  PB tính được                   : ${pbOk.size} trạm`);
console.log(`  (so theo TÊN chỉ để tham khảo — hai nguồn đặt mã khác nhau:`);
console.log(`   chỉ ở PB ${onlyPb.length} · chỉ ở CSV ${onlyCsv.length})`);

line();
console.log(`\nĐỐI CHIẾU THEO SERIAL CÔNG TƠ — ${csvMainMeters.length} công tơ chính đang vận hành của HES`);
console.log(`  Khớp hoàn toàn, tính được               : ${meterVerdict.OK.length}`);
for (const [k, title] of [
  ['TRAM_THIEU_THONG_SO', 'Trạm trong PB THIẾU p0_w/pk_w/sdm_kva'],
  ['DIEM_DO_KHONG_ACTIVE', 'Điểm đo trong PB không phải chinh+active'],
  ['PB_KHONG_TREO', 'Có trong dm_asset nhưng KHÔNG đang treo'],
  ['KHONG_CO_TRONG_PB', 'KHÔNG có trong dm_asset'],
]) {
  console.log(`  ${title.padEnd(40)}: ${meterVerdict[k].length}`);
  meterVerdict[k].forEach(x => console.log('       ' + x));
}
const lost = csvMainMeters.length - meterVerdict.OK.length;
line();
console.log(`\n⇒ Đổi nguồn sang PB: ${meterVerdict.OK.length}/${csvMainMeters.length} công tơ chính đi tiếp`
  + `, ${lost} cần xử lý trước.`);
line();
