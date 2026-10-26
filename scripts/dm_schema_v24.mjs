#!/usr/bin/env node
/**
 * Schema đợt 24 — LOẠI CÔNG TƠ trực tiếp / gián tiếp (user yêu cầu 26/10/2026):
 * công tơ trực tiếp dùng cho điểm đo KHÔNG có TI, gián tiếp cho điểm đo qua TI.
 *
 * CHỈ THÊM, không đụng trường/dữ liệu có sẵn:
 *  - `dm_device.meter_kind`        select truc_tiep | gian_tiep (chỉ có nghĩa với CONGTO)
 *  - `dm_purchase_line.meter_kind` như trên — đặt mua đúng loại công tơ
 * (`dm_point.need` là json — dòng nhu cầu tự mang `meter_kind`, không cần đổi schema.)
 *
 * Mặc định dry-run. 9 collection bảo vệ phải không đổi; hai collection sửa chỉ được
 * khác đúng trường mới.
 *   railway run -- node scripts/dm_schema_v24.mjs [--apply]
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
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
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];
const FIELD = { name: 'meter_kind', type: 'select', required: false, presentable: false, maxSelect: 1, values: ['truc_tiep', 'gian_tiep'] };
const TARGETS = ['dm_device', 'dm_purchase_line'];

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) { console.error('Thiếu tài khoản PocketBase. Chạy qua `railway run`.'); process.exit(1); }

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};
const send = (method, path, body) => {
  const f = join(mkdtempSync(join(tmpdir(), 'dmv24-')), 'body.json');
  fs.writeFileSync(f, JSON.stringify(body));
  try { return curl(['-X', method, `${PB}${path}`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${f}`]); }
  finally { rmSync(f, { force: true }); }
};

/* Đăng nhập: mật khẩu đi qua FILE tạm, không qua dòng lệnh. */
let H = [];
const auth = send('POST', '/api/collections/_superusers/auth-with-password', { identity: email, password });
if (!auth?.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
H = ['-H', `Authorization: ${auth.token}`];

const listCols = () => curl([`${PB}/api/collections?perPage=500`, ...H]).items || [];
const snap = cols => JSON.stringify(PROTECTED.map(n => cols.find(c => c.name === n) ?? null).map(c => c && { ...c, updated: undefined }));
const sansNew = c => JSON.stringify({ ...c, updated: undefined, fields: (c.fields ?? []).filter(f => f.name !== FIELD.name) });

let cols = listCols();
const before = snap(cols);
const targets = TARGETS.map(n => cols.find(c => c.name === n));
if (targets.some(c => !c)) { console.error('Thiếu dm_device / dm_purchase_line (chạy v23 trước)'); process.exit(1); }
const todo = targets.filter(c => !c.fields.some(f => f.name === FIELD.name));
console.log(`\nPB: ${PB}`);
for (const c of targets) console.log(todo.includes(c) ? `SẼ THÊM ${c.name}.meter_kind [truc_tiep, gian_tiep]` : `= Đã có ${c.name}.meter_kind`);
if (!todo.length) process.exit(0);
if (!APPLY) { console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.\n'); process.exit(0); }

const keep = new Map(targets.map(c => [c.name, sansNew(c)]));
for (const c of todo) {
  /* PATCH phải gửi đủ danh sách trường cũ (kèm id) — thiếu trường nào là PocketBase xoá trường đó. */
  const res = send('PATCH', `/api/collections/${c.id}`, { fields: [...c.fields, FIELD] });
  if (!(res.fields ?? []).some(f => f.name === FIELD.name)) { console.error(`Thêm vào ${c.name} thất bại:`, JSON.stringify(res).slice(0, 400)); process.exit(1); }
  console.log(`OK — ${c.name} thêm meter_kind`);
}
cols = listCols();
if (snap(cols) !== before) { console.error('\n⚠️  Collection bảo vệ BỊ THAY ĐỔI!'); process.exit(1); }
for (const n of TARGETS) if (sansNew(cols.find(c => c.name === n)) !== keep.get(n)) { console.error(`\n⚠️  ${n} đổi ngoài meter_kind!`); process.exit(1); }
console.log('\nKiểm lại: chỉ thêm meter_kind; collection bảo vệ không đổi.');
