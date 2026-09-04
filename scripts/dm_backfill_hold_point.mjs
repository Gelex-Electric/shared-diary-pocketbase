#!/usr/bin/env node
/**
 * Backfill `dm_device.hold_point` — chuyển việc GIỮ CHỖ từ `dm_asset` lên
 * chính thiết bị (plan 2026-08-28, sửa sau đợt schema v14).
 *
 * Nguồn: dòng `dm_asset` có `point` nhưng KHÔNG có `date_on` — nghĩa là đã khai
 * thiết bị vào một điểm đo mà chưa treo. Đó chính là "dành sẵn cho điểm đo
 * này".
 *
 * CHỈ GHI `hold_point`. KHÔNG xoá dòng `dm_asset` nào: form điểm đo vẫn đang
 * đọc mấy dòng đó để hiện vật tư dự kiến. Xoá là việc của bước 3, sau khi form
 * đã chuyển sang đọc `hold_point`. Mỗi bước phải tự đứng được.
 *
 * CHẠY THỬ mặc định. `--apply` mới ghi. Chạy lại được.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_backfill_hold_point.mjs
 */
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--all');
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
const [devices, assets, points] = await Promise.all(
  ['dm_device', 'dm_asset', 'dm_point'].map(allOf));

const ymd = (v) => String(v ?? '').slice(0, 10);
const codeOf = Object.fromEntries(points.map(p => [p.id, p.code || p.line_name || '—']));
const devById = new Map(devices.map(d => [d.id, d]));
const devBySerial = new Map(devices.map(d => [String(d.serial).trim(), d]));

/* --------------- Dòng giữ chỗ: có điểm đo, chưa có ngày treo --------------- */
const holds = assets.filter(a => a.point && !ymd(a.date_on));

const plan = [];
const conflict = [];
const orphan = [];
const byDevice = new Map();
for (const a of holds) {
  const dev = (a.device && devById.get(a.device)) || devBySerial.get(String(a.serial).trim());
  if (!dev) { orphan.push(a); continue; }
  byDevice.set(dev.id, [...(byDevice.get(dev.id) ?? []), a]);
}
for (const [devId, rows] of byDevice) {
  const dev = devById.get(devId);
  const pts = [...new Set(rows.map(r => r.point))];
  if (pts.length > 1) {
    // Một thiết bị được giữ chỗ ở HAI điểm đo — phải xử tay, không đoán.
    conflict.push({ dev, codes: pts.map(p => codeOf[p] ?? p) });
    continue;
  }
  if (dev.hold_point === pts[0]) continue;    // đã đúng, chạy lại lần hai
  plan.push({ dev, point: pts[0], code: codeOf[pts[0]] ?? pts[0] });
}

/* ------------------------------- In ra ------------------------------- */
console.log(`dm_asset            : ${assets.length} dòng`);
console.log(`Dòng GIỮ CHỖ        : ${holds.length}  (có điểm đo, chưa có ngày treo)`);
console.log(`dm_device           : ${devices.length}`);
console.log(`\nSẼ GHI hold_point   : ${plan.length} thiết bị`);

const byPoint = new Map();
for (const x of plan) byPoint.set(x.code, (byPoint.get(x.code) ?? 0) + 1);
const rows = [...byPoint.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi', { numeric: true }));
for (const [code, n] of rows.slice(0, VERBOSE ? rows.length : 15)) {
  console.log(`   ${code.padEnd(34)} ${n} vật tư`);
}
if (!VERBOSE && rows.length > 15) console.log(`   … còn ${rows.length - 15} điểm đo (thêm --all)`);

if (conflict.length) {
  console.log(`\n⚠ GIỮ CHỖ Ở HAI NƠI : ${conflict.length} — bỏ qua, phải xử tay`);
  for (const c of conflict) console.log(`   ${c.dev.serial}: ${c.codes.join(' | ')}`);
}
if (orphan.length) {
  console.log(`\n⚠ Không tìm được thiết bị tương ứng : ${orphan.length}`);
  for (const a of orphan) console.log(`   ${a.serial} @ ${codeOf[a.point] ?? '—'}`);
}
console.log('\nKHÔNG xoá dòng dm_asset nào — form điểm đo vẫn đang đọc chúng.');

if (!APPLY) { console.log('\nCHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }

let n = 0;
for (const x of plan) {
  const r = await fetch(`${PB}/api/collections/dm_device/records/${x.dev.id}`, {
    method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hold_point: x.point }),
  });
  if (!r.ok) throw new Error(`${x.dev.serial}: ${JSON.stringify(await r.json())}`);
  n++;
  if (n % 50 === 0) console.log(`   … ${n}`);
}
console.log(`\nĐã ghi hold_point cho ${n} thiết bị.`);
