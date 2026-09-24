#!/usr/bin/env node
/**
 * Schema đợt 16 — hai cờ trên `dm_station` cho phần tổn thất (user chốt 23/09/2026).
 *
 * 1. `auto_loss_param` (bool) — "Tính tự động P0, Pk".
 *    Trạm chưa có biên bản kiểm định thì lấy TRUNG BÌNH P0/Pk của các trạm cùng
 *    `sdm_kva` đã có số thật. CHỈ lưu cờ, KHÔNG lưu giá trị: khai thêm một trạm
 *    có số thật thì ước lượng của mọi trạm cùng công suất tự tốt lên, và số ước
 *    lượng không bao giờ nằm trong ô `p0_w` để ai đó tưởng là số đo.
 *    Luật tính nằm ở `scripts/lib/lossParams.mjs` (app và pipeline dùng chung).
 *
 * 2. `mv_metering` (bool) — "Điểm đo trung thế".
 *    Trạm mua bán điện phía trung thế: tổn thất máy biến áp là của khách hàng,
 *    KHÔNG tính cho mình. Trạm bị bỏ khỏi bảng tổn thất như một CHỦ Ý, và được
 *    in ở mục riêng trong log chứ không trộn với nhóm thiếu dữ liệu.
 *
 * Vì sao cần: T0 (`logs/2026-09-23-t0-soat-danh-muc-ton-that.md`) cho thấy 7 trạm
 * thiếu `p0_w`/`pk_w` — và `mba_info.csv` cũng trống đúng 7 trạm đó, tức số liệu
 * nhãn máy chưa từng có. Hai cờ này là cách khai ra hai nguyên nhân thật: chưa có
 * biên bản, hoặc mua bán điện trung thế.
 *
 * CHỈ đụng `dm_station`, CHỈ THÊM trường, không sửa/không xoá gì. Mặc định dry-run.
 * Gọi mạng bằng `curl`: mạng công ty chặn cert của Node (bài học 17/09).
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- \
 *     node scripts/dm_schema_v16.mjs            # xem trước, KHÔNG ghi
 *   ... node scripts/dm_schema_v16.mjs --apply  # ghi thật
 *
 * ⚠️ staging và production DÙNG CHUNG một PocketBase — chạy một lần là áp cho cả hai.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const TARGET = 'dm_station';

/* Danh sách collection KHÔNG được đụng tới — giữ nguyên như các đợt schema trước. */
const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];
if (PROTECTED.includes(TARGET)) {
  console.error(`Đụng collection được bảo vệ: ${TARGET}`); process.exit(1);
}

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Thiếu tài khoản PocketBase. Chạy qua `railway run`, hoặc truyền '
    + 'PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.');
  process.exit(1);
}

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); }
  catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};

/* Đăng nhập: mật khẩu đi qua FILE tạm, không qua dòng lệnh (dòng lệnh lộ trong ps). */
const tmp = mkdtempSync(join(tmpdir(), 'dmv15-'));
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (!auth?.token) {
  console.error('Đăng nhập PocketBase thất bại (cần tài khoản QUẢN TRỊ để sửa schema):',
    JSON.stringify(auth).slice(0, 200));
  process.exit(1);
}
const H = ['-H', `Authorization: ${auth.token}`];

const cols = curl([`${PB}/api/collections?perPage=500`, ...H]);
const col = (cols.items || []).find(c => c.name === TARGET);
if (!col) { console.error(`Không thấy collection ${TARGET}.`); process.exit(1); }

const fields = col.fields ?? col.schema ?? [];
const has = (n) => fields.some(f => f.name === n);
const total = curl([`${PB}/api/collections/${TARGET}/records?perPage=1`, ...H]).totalItems;

console.log(`\nPB: ${PB}`);
console.log(`${TARGET}: ${total} bản ghi · ${fields.length} trường\n`);

const them = [];
const mo = [
  ['auto_loss_param', 'Tính tự động P0, Pk (trung bình các trạm cùng công suất)'],
  ['mv_metering', 'Điểm đo trung thế — KHÔNG tính tổn thất trạm này'],
];
for (const [ten, mota] of mo) {
  if (has(ten)) { console.log(`= ${ten.padEnd(16)} đã có, bỏ qua.`); continue; }
  them.push({ name: ten, type: 'bool', required: false });
  console.log(`SẼ THÊM  ${ten.padEnd(16)} bool — ${mota}`);
}

if (!them.length) { console.log('\nKhông có gì để làm.'); process.exit(0); }

console.log('\nKHÔNG sửa, KHÔNG xoá trường nào. KHÔNG đụng collection khác.');
console.log('Trường bool mới mặc định false ⇒ mọi trạm hiện có giữ nguyên hành vi.');

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

/* Gửi nguyên danh sách trường cũ + trường mới. Giữ `indexes` y nguyên: đợt 14 đã
   trả giá vì PB dựng lại bảng rồi mới tạo index. */
const patchFile = join(mkdtempSync(join(tmpdir(), 'dmv15p-')), 'patch.json');
fs.writeFileSync(patchFile, JSON.stringify({ fields: [...fields, ...them] }));
const res = curl(['-X', 'PATCH', `${PB}/api/collections/${col.id}`,
  '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${patchFile}`]);
rmSync(patchFile, { force: true });

const sau = (res.fields ?? res.schema ?? []).map(f => f.name);
const thieu = them.map(f => f.name).filter(n => !sau.includes(n));
if (thieu.length) {
  console.error(`\nGHI XONG NHƯNG THIẾU: ${thieu.join(', ')}`);
  console.error(JSON.stringify(res).slice(0, 300));
  process.exit(1);
}
console.log(`\nOK — ${TARGET} nay có ${sau.length} trường, đã thêm: ${them.map(f => f.name).join(', ')}`);
