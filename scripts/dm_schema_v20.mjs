#!/usr/bin/env node
/**
 * Schema đợt 20 — XÓA các trường của chức năng gửi email đã gỡ (user chốt 02/10/2026).
 *
 * Gửi email hóa đơn từ server bị bỏ (Railway gói Hobby chặn SMTP; user chuyển sang Power Automate,
 * rồi gỡ hẳn trang Hóa đơn điện tử). Các trường chỉ phục vụ việc gửi thư nay không dùng:
 *   einvoice     mail_status, mail_sent_at, mail_to, mail_error   (einvoice_schema.mjs)
 *   dm_zone      email_ops, email_parent                          (dm_schema_v19.mjs)
 *   dm_customer  email                                            (dm_schema_v18.mjs)
 *
 * ⚠️ XÓA TRƯỜNG = MẤT DỮ LIỆU TRONG TRƯỜNG ĐÓ, không hoàn tác. Xem trước in số bản ghi đang có dữ
 * liệu ở từng trường. Không đụng trường khác, không xóa bản ghi, giữ nguyên index không chứa trường bị xóa.
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- node scripts/dm_schema_v20.mjs [--apply]
 * ⚠️ staging và production DÙNG CHUNG một PocketBase — chạy một lần là áp cho cả hai.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const DROP = {
  einvoice: ['mail_status', 'mail_sent_at', 'mail_to', 'mail_error'],
  dm_zone: ['email_ops', 'email_parent'],
  dm_customer: ['email'],
};

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) { console.error('Thiếu tài khoản PocketBase (chạy qua railway run).'); process.exit(1); }

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};

const tmp = mkdtempSync(join(tmpdir(), 'dmv20-'));
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (!auth?.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
const H = ['-H', `Authorization: ${auth.token}`];

const cols = curl([`${PB}/api/collections?perPage=500`, ...H]).items || [];
console.log(`\nPB: ${PB}`);
const plan = [];
for (const [name, drop] of Object.entries(DROP)) {
  const col = cols.find(c => c.name === name);
  if (!col) { console.error(`Không thấy collection ${name}.`); process.exit(1); }
  const fields = col.fields ?? [];
  const present = drop.filter(n => fields.some(f => f.name === n));
  const total = curl([`${PB}/api/collections/${name}/records?perPage=1`, ...H]).totalItems;
  if (!present.length) { console.log(`= ${name}: không còn trường nào cần xóa.`); continue; }
  // Đếm bản ghi đang có dữ liệu ở từng trường sắp xóa (để biết sẽ mất gì).
  const filled = Object.fromEntries(present.map(n => [n, 0]));
  for (let p = 1; ; p++) {
    const r = curl([`${PB}/api/collections/${name}/records?perPage=500&page=${p}&fields=${present.join(',')}`, ...H]);
    for (const x of r.items ?? []) for (const n of present) if (x[n] !== '' && x[n] != null && x[n] !== 0) filled[n]++;
    if (p >= (r.totalPages ?? 1)) break;
  }
  for (const n of present) console.log(`SẼ XÓA   ${name}.${n}  — đang có dữ liệu ở ${filled[n]}/${total} bản ghi`);
  const badIdx = (col.indexes ?? []).filter(i => present.some(n => i.includes(`\`${n}\``)));
  if (badIdx.length) { console.error(`Index của ${name} đang dùng trường sắp xóa: ${badIdx.join(' | ')} — dừng.`); process.exit(1); }
  plan.push({ col, keep: fields.filter(f => !present.includes(f.name)), present, total });
}
console.log('KHÔNG xóa bản ghi nào, KHÔNG đụng trường khác.');
if (!plan.length) { console.log('\nKhông có gì để làm.'); process.exit(0); }
if (!APPLY) { console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để xóa thật.\n'); process.exit(0); }

for (const { col, keep, present, total } of plan) {
  const f = join(mkdtempSync(join(tmpdir(), 'dmv20p-')), 'patch.json');
  fs.writeFileSync(f, JSON.stringify({ fields: keep, indexes: col.indexes ?? [] }));
  const res = curl(['-X', 'PATCH', `${PB}/api/collections/${col.id}`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${f}`]);
  rmSync(f, { force: true });
  const got = (res.fields ?? []).map(x => x.name);
  const total2 = curl([`${PB}/api/collections/${col.name}/records?perPage=1`, ...H]).totalItems;
  if (present.some(n => got.includes(n)) || got.length !== keep.length || total2 !== total) {
    console.error(`\n${col.name}: GHI XONG NHƯNG KIỂM LẠI KHÔNG ĐẠT:`, JSON.stringify(res).slice(0, 400)); process.exit(1);
  }
  console.log(`OK — ${col.name}: đã xóa ${present.join(', ')}. ${got.length} trường, ${total2} bản ghi (trước: ${total}).`);
}
