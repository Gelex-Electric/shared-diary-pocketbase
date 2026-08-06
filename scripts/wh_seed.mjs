/**
 * Task 2 — Seed danh muc co dinh cho mang Quan ly kho: 6 kho + 5 loai thiet bi.
 * Plan: plans/2026-08-06-quan-ly-kho-thiet-bi.md (muc 5.1, 5.2, 5.2b).
 *
 * Chay:
 *   PB_URL=... PB_EMAIL=... PB_PASS=... node scripts/wh_seed.mjs [--dry-run]
 *
 * Idempotent: khop theo `code`, da co thi PATCH, chua co thi POST.
 */

const PB_URL = (process.env.PB_URL || '').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_EMAIL || '';
const PB_PASS = process.env.PB_PASS || '';
const DRY = process.argv.includes('--dry-run');

if (!PB_URL || !PB_EMAIL || !PB_PASS) {
  console.error('Thieu PB_URL / PB_EMAIL / PB_PASS trong bien moi truong.');
  process.exit(1);
}

/**
 * 6 kho — moi KCN dung 1 kho (user chot 2026-08-06: "Du phong"/"Thu hoi"
 * trong Excel KHONG phai 2 kho, ma la nguon goc thiet bi -> wh_device.nguon_goc).
 * `code` = tien to ma diem do trong Excel, de import map duoc thang.
 */
const WAREHOUSES = [
  { code: 'TH',   name: 'Kho KCN Tiền Hải',       zone: 'KCN Tiền Hải',       active: true },
  { code: 'PĐ',   name: 'Kho KCN Phong Điền',     zone: 'KCN Phong Điền',     active: true },
  { code: 'TTI',  name: 'Kho KCN Thuận Thành I',  zone: 'KCN Thuận Thành I',  active: true },
  { code: 'YM',   name: 'Kho KCN Yên Mỹ',         zone: 'KCN Yên Mỹ',         active: true },
  { code: '03',   name: 'Kho KCN Số 3',           zone: 'KCN Số 3',           active: true },
  { code: 'GETC', name: 'Kho Văn phòng 52 Lê Đại Hành', zone: 'GETC',         active: true },
];

/**
 * 5 loai thiet bi.
 * - CONGTO gom ca ME41 (gian tiep, BAT BUOC co TI) va ME42 (truc tiep, khong
 *   can TI, HSN=1) — phan biet bang wh_device.model, KHONG tach thanh 2 loai.
 *   Luat kiem tra theo model nam o src/lib/warehouse.ts (task 5).
 * - SIM la phu kien, khong bat buoc, nhung van quan ly (user chot 2026-08-06).
 * - TU: chua co ban ghi nao trong du lieu that, van khai bao san.
 */
const DEVICE_TYPES = [
  { code: 'CONGTO', name: 'Công tơ điện tử',          required_at_point: true,  max_per_point: 1, has_calibration: true,  order_index: 1 },
  { code: 'GP03',   name: 'Thiết bị truyền tin GP-03', required_at_point: true,  max_per_point: 1, has_calibration: false, order_index: 2 },
  { code: 'TI',     name: 'Biến dòng đo lường TI',     required_at_point: false, max_per_point: 3, has_calibration: true,  order_index: 3 },
  { code: 'TU',     name: 'Biến điện áp TU',           required_at_point: false, max_per_point: 3, has_calibration: true,  order_index: 4 },
  { code: 'SIM',    name: 'Sim truyền dữ liệu',        required_at_point: false, max_per_point: 1, has_calibration: false, order_index: 5 },
];

async function api(token, path, opts = {}) {
  const res = await fetch(`${PB_URL}/api${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}), ...opts.headers },
  });
  const body = await res.text();
  let json; try { json = JSON.parse(body); } catch { json = body; }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

async function login() {
  for (const coll of ['_superusers', 'users']) {
    try {
      const r = await api('', `/collections/${coll}/auth-with-password`, {
        method: 'POST', body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASS }),
      });
      if (r.token) return r.token;
    } catch { /* thu tiep */ }
  }
  throw new Error('Dang nhap PocketBase that bai.');
}

/** Upsert theo field `code`. Tra ve {created, updated}. */
async function upsert(token, coll, rows) {
  const existing = await api(token, `/collections/${coll}/records?perPage=500`);
  const byCode = Object.fromEntries(existing.items.map(r => [r.code, r]));
  let created = 0, updated = 0;
  for (const row of rows) {
    const cur = byCode[row.code];
    if (cur) {
      updated++;
      if (!DRY) await api(token, `/collections/${coll}/records/${cur.id}`, { method: 'PATCH', body: JSON.stringify(row) });
    } else {
      created++;
      if (!DRY) await api(token, `/collections/${coll}/records`, { method: 'POST', body: JSON.stringify(row) });
    }
  }
  return { created, updated };
}

const token = await login();
console.log(`PocketBase: ${PB_URL}`);
if (DRY) console.log('*** DRY-RUN: khong ghi gi len server ***');

const w = await upsert(token, 'wh_warehouse', WAREHOUSES);
console.log(`  wh_warehouse   : them ${w.created}, cap nhat ${w.updated}`);
const t = await upsert(token, 'wh_device_type', DEVICE_TYPES);
console.log(`  wh_device_type : them ${t.created}, cap nhat ${t.updated}`);

if (!DRY) {
  console.log('\n--- Kiem chung ---');
  let ok = true;
  for (const [coll, expect] of [['wh_warehouse', WAREHOUSES], ['wh_device_type', DEVICE_TYPES]]) {
    const r = await api(token, `/collections/${coll}/records?perPage=500&sort=code`);
    const codes = r.items.map(x => x.code).sort();
    const want = expect.map(x => x.code).sort();
    const same = codes.length === want.length && codes.every((c, i) => c === want[i]);
    console.log(`  ${same ? 'v' : 'X'} ${coll}: ${r.totalItems} ban ghi [${codes.join(', ')}]`);
    if (!same) { console.log(`      mong doi: [${want.join(', ')}]`); ok = false; }
  }
  process.exit(ok ? 0 : 1);
}
