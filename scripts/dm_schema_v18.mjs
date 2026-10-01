#!/usr/bin/env node
/**
 * Schema đợt 18 — thêm `email` vào `dm_customer` (user chốt 01/10/2026).
 *
 * Email nhận thư của khách hàng — dùng cho tính năng gửi email chốt chỉ số
 * (plan 2026-10-01-gui-email-chot-chi-so.md). MỘT trường text, chứa MỘT HOẶC
 * NHIỀU địa chỉ ngăn bằng `;` (vd `ketoan@kh.vn; kythuat@kh.vn`). Định dạng từng
 * địa chỉ kiểm ở form (`lib/dm/email.ts`), PB chỉ giới hạn độ dài.
 *
 * Chỉ THÊM một trường rỗng trên `dm_customer`. Không xoá/sửa trường nào, không
 * đổi dữ liệu, không đụng collection khác. Mặc định dry-run.
 * Gọi mạng bằng `curl` (mạng công ty chặn cert của Node).
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- \
 *     node scripts/dm_schema_v18.mjs            # xem trước, KHÔNG ghi
 *   ... node scripts/dm_schema_v18.mjs --apply  # ghi thật
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
const TARGET = 'dm_customer';
const FIELD = 'email';

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
const tmp = mkdtempSync(join(tmpdir(), 'dmv18-'));
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
const total = curl([`${PB}/api/collections/${TARGET}/records?perPage=1`, ...H]).totalItems;

console.log(`\nPB: ${PB}`);
console.log(`${TARGET}: ${total} bản ghi · ${fields.length} trường: ${fields.map(f => f.name).join(', ')}\n`);

if (fields.some(f => f.name === FIELD)) {
  console.log(`= ${FIELD} đã có, không có gì để làm.`);
  process.exit(0);
}

/* 500 ký tự: đủ cho ~15 địa chỉ, chặn dán nhầm cả đoạn văn. */
const next = [...fields.map(f => ({ ...f })),
  { name: FIELD, type: 'text', required: false, presentable: false, min: 0, max: 500, pattern: '' }];
console.log(`SẼ ĐỔI   ${FIELD}  THÊM text (≤500 ký tự), không bắt buộc — một hoặc nhiều địa chỉ ngăn bằng ';'`);
console.log('KHÔNG xoá trường nào, KHÔNG đổi dữ liệu, KHÔNG đụng collection khác. Giữ nguyên index cũ.');

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

const patchFile = join(mkdtempSync(join(tmpdir(), 'dmv18p-')), 'patch.json');
fs.writeFileSync(patchFile, JSON.stringify({ fields: next, indexes: col.indexes ?? [] }));
const res = curl(['-X', 'PATCH', `${PB}/api/collections/${col.id}`,
  '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${patchFile}`]);
rmSync(patchFile, { force: true });

const f2 = res.fields ?? [];
if (!f2.some(f => f.name === FIELD && f.type === 'text') || f2.length !== fields.length + 1) {
  console.error('\nGHI XONG NHƯNG KIỂM LẠI KHÔNG ĐẠT:', JSON.stringify(res).slice(0, 400)); process.exit(1);
}
const total2 = curl([`${PB}/api/collections/${TARGET}/records?perPage=1`, ...H]).totalItems;
console.log(`\nOK — ${TARGET}: thêm ${FIELD}. ${f2.length} trường, ${total2} bản ghi (trước: ${total}).`);
