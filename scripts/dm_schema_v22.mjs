#!/usr/bin/env node
/**
 * Schema đợt 22 — nhóm tài khoản (user duyệt plan 23/10/2026, `plans/2026-10-23-ba-nhom-dang-nhap-nhom-vat-tu.md`).
 *
 * THÊM đúng MỘT trường vào `users`: `nhom` (select 1 giá trị, không bắt buộc)
 *   van_hanh | kinh_doanh | vat_tu
 * Trống = luật cũ theo `area` (có area = Vận hành, trống = Kinh doanh) ⇒ tài khoản cũ không phải sửa.
 *
 * `users` nằm trong danh sách bảo vệ của các đợt trước; đợt này là ngoại lệ có duyệt nên
 * script tự kiểm: sau khi ghi, `users` chỉ được khác đúng trường `nhom`, 8 collection bảo vệ
 * còn lại không đổi. Không xoá trường, không đổi rule, không đụng dữ liệu.
 *
 * Mặc định dry-run. Gọi mạng bằng `curl`.
 *   railway run -- node scripts/dm_schema_v22.mjs            # xem trước, KHÔNG ghi
 *   railway run -- node scripts/dm_schema_v22.mjs --apply    # ghi thật
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

const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update',
];
const FIELD = {
  name: 'nhom', type: 'select', required: false, presentable: false, maxSelect: 1,
  values: ['van_hanh', 'kinh_doanh', 'vat_tu'],
};

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) {
  console.error('Thiếu tài khoản PocketBase. Chạy qua `railway run`, hoặc truyền PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD.');
  process.exit(1);
}

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); }
  catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};

/* Đăng nhập: mật khẩu đi qua FILE tạm, không qua dòng lệnh. */
const tmp = mkdtempSync(join(tmpdir(), 'dmv22-'));
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (!auth?.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
const H = ['-H', `Authorization: ${auth.token}`];

const listCols = () => curl([`${PB}/api/collections?perPage=500`, ...H]).items || [];
const snap = cols => JSON.stringify(PROTECTED.map(n => cols.find(c => c.name === n) ?? null)
  .map(c => c && { ...c, updated: undefined }));
/** `users` bỏ trường `nhom` — phải giống hệt trước và sau khi ghi. */
const usersSnap = c => JSON.stringify({ ...c, updated: undefined, fields: (c.fields ?? []).filter(f => f.name !== FIELD.name) });

const cols = listCols();
const before = snap(cols);
const users = cols.find(c => c.name === 'users');
if (!users) { console.error('Không thấy collection users'); process.exit(1); }
const usersBefore = usersSnap(users);

console.log(`\nPB: ${PB}`);
console.log(`users hiện có ${users.fields.length} trường: ${users.fields.map(f => f.name).join(', ')}`);
const existed = users.fields.find(f => f.name === FIELD.name);
if (existed) {
  console.log(`= Đã có users.${FIELD.name} (${existed.type} [${(existed.values ?? []).join(', ')}]), bỏ qua.`);
  process.exit(0);
}
console.log(`SẼ THÊM users.${FIELD.name}: select 1 giá trị, không bắt buộc, [${FIELD.values.join(', ')}]`);
console.log('KHÔNG đổi trường/rule/dữ liệu nào khác.');

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

/* PATCH phải gửi đủ danh sách trường cũ (kèm id) — thiếu trường nào là PocketBase xoá trường đó. */
const f = join(mkdtempSync(join(tmpdir(), 'dmv22c-')), 'col.json');
fs.writeFileSync(f, JSON.stringify({ fields: [...users.fields, FIELD] }));
const res = curl(['-X', 'PATCH', `${PB}/api/collections/${users.id}`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${f}`]);
rmSync(f, { force: true });
if (!(res.fields ?? []).some(x => x.name === FIELD.name)) {
  console.error('Thêm trường thất bại:', JSON.stringify(res).slice(0, 500)); process.exit(1);
}
console.log(`OK — users có ${res.fields.length} trường, đã thêm ${FIELD.name}.`);

const colsAfter = listCols();
const usersAfter = colsAfter.find(c => c.name === 'users');
if (snap(colsAfter) !== before) { console.error('\n⚠️  8 collection bảo vệ BỊ THAY ĐỔI — kiểm tra ngay!'); process.exit(1); }
if (!usersAfter || usersSnap(usersAfter) !== usersBefore) { console.error('\n⚠️  users đổi ngoài trường nhom — kiểm tra ngay!'); process.exit(1); }
console.log('\nKiểm lại: users chỉ thêm trường nhom; 8 collection bảo vệ không đổi.');
