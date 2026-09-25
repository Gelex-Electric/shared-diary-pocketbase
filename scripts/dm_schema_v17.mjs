#!/usr/bin/env node
/**
 * Schema đợt 17 — ĐIỂM ĐO ĐẦU NGUỒN trên `dm_point` (plan 2026-09-24-diem-do-dau-nguon.md).
 *
 * Công tơ đầu nguồn (vd 2246006313 TTI.DIEMDOPHU) đo TỔNG một lộ: không thuộc trạm
 * nào, không thuộc khách hàng nào. Trước đây sống bằng ngoại lệ tên cứng; nay cho
 * nó vai trò thật trong Danh mục để công tơ/TI/TU, lịch sử treo, HSN suy từ TI,
 * liveMeters… tự chạy như điểm đo thường.
 *
 * Ba thay đổi, CHỈ trên `dm_point`:
 *   1. `role` thêm giá trị `dau_nguon` (giữ nguyên `chinh`, `phu`).
 *   2. Thêm `line` — relation `dm_line`, 1 bản ghi. Bắt buộc với `dau_nguon`
 *      (kiểm ở form + script, PB không ràng buộc có điều kiện được).
 *   3. `station` BỎ bắt buộc — đầu nguồn không thuộc trạm. Ràng buộc "chinh/phu
 *      phải có trạm" chuyển sang form. Bản ghi hiện có đều đã có trạm, không đổi.
 *   + index `idx_dm_point_line`.
 *
 * Không xoá trường, không đổi dữ liệu, không đụng collection khác. Rule (list/view/
 * create/update/delete = đã đăng nhập) không nhắc tới `station` ⇒ không ảnh hưởng.
 * Mặc định dry-run. Gọi mạng bằng `curl` (mạng công ty chặn cert của Node).
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- \
 *     node scripts/dm_schema_v17.mjs            # xem trước, KHÔNG ghi
 *   ... node scripts/dm_schema_v17.mjs --apply  # ghi thật
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
const TARGET = 'dm_point';

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
const tmp = mkdtempSync(join(tmpdir(), 'dmv17-'));
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

const lineCol = (cols.items || []).find(c => c.name === 'dm_line');
if (!lineCol) { console.error('Không thấy collection dm_line.'); process.exit(1); }

const next = fields.map(f => ({ ...f }));
const doi = [];
const role = next.find(f => f.name === 'role');
if (!role.values.includes('dau_nguon')) {
  role.values = [...role.values, 'dau_nguon'];
  doi.push(`role      thêm giá trị dau_nguon → [${role.values.join(' | ')}]`);
} else console.log('= role      đã có dau_nguon, bỏ qua.');
const station = next.find(f => f.name === 'station');
if (station.required) {
  station.required = false;
  doi.push('station   bỏ bắt buộc (đầu nguồn không thuộc trạm; chinh/phu kiểm ở form)');
} else console.log('= station   đã không bắt buộc, bỏ qua.');
if (!has('line')) {
  next.push({ name: 'line', type: 'relation', required: false, collectionId: lineCol.id,
    cascadeDelete: false, maxSelect: 1, minSelect: 0 });
  doi.push(`line      THÊM relation → dm_line (${lineCol.id}), 1 bản ghi`);
} else console.log('= line      đã có, bỏ qua.');
const idx = 'CREATE INDEX `idx_dm_point_line` ON `dm_point` (`line`)';
const indexes = [...(col.indexes ?? [])];
if (!indexes.some(i => i.includes('idx_dm_point_line`'))) {
  indexes.push(idx);
  doi.push('index     thêm idx_dm_point_line');
}

for (const d of doi) console.log(`SẼ ĐỔI   ${d}`);
if (!doi.length) { console.log('\nKhông có gì để làm.'); process.exit(0); }

const nRole = {};
for (let p = 1; ; p++) {
  const r = curl([`${PB}/api/collections/${TARGET}/records?perPage=500&page=${p}&fields=role,station`, ...H]);
  for (const x of r.items ?? []) nRole[x.role] = (nRole[x.role] ?? 0) + (x.station ? 0 : 1000) + 1;
  if (p >= (r.totalPages ?? 1)) break;
}
console.log(`\nBản ghi hiện có theo role: ${JSON.stringify(nRole)} (cộng 1000 nếu thiếu trạm — phải KHÔNG có)`);
console.log('KHÔNG xoá trường nào, KHÔNG đổi dữ liệu, KHÔNG đụng collection khác. Giữ nguyên index cũ.');

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

/* Gửi nguyên danh sách trường (đã sửa) + index cũ + index mới. */
const patchFile = join(mkdtempSync(join(tmpdir(), 'dmv17p-')), 'patch.json');
fs.writeFileSync(patchFile, JSON.stringify({ fields: next, indexes }));
const res = curl(['-X', 'PATCH', `${PB}/api/collections/${col.id}`,
  '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${patchFile}`]);
rmSync(patchFile, { force: true });

const f2 = res.fields ?? [];
const ok = f2.find(f => f.name === 'role')?.values?.includes('dau_nguon')
  && f2.find(f => f.name === 'station')?.required === false
  && f2.some(f => f.name === 'line' && f.type === 'relation')
  && (res.indexes ?? []).some(i => i.includes('idx_dm_point_line`'));
if (!ok) { console.error('\nGHI XONG NHƯNG KIỂM LẠI KHÔNG ĐẠT:', JSON.stringify(res).slice(0, 400)); process.exit(1); }
console.log(`\nOK — ${TARGET}: role có dau_nguon, station không bắt buộc, có line + index. ${f2.length} trường.`);
