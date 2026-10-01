#!/usr/bin/env node
/**
 * `einvoice` đợt 2 — thêm 3 trường để mở PDF CCIS (plans/2026-10-01-ccis-billval-pdf.md):
 *   billval           text ≤500 — BILLVAL đã thay XYZ1..4, CHƯA URL-encode. Là link xem PDF
 *                     không cần đăng nhập CCIS ⇒ chỉ người xem được einvoice mới thấy (rule cũ).
 *   ccis_department   number — DepartmentId trên CCIS (GetBillInfo)
 *   ccis_figure_book  number — FigureBookId của sổ chứa hóa đơn (đã xác nhận bằng GetBill)
 * Server (`server/einvoiceApi.ts`) ghi 3 trường này; PDF KHÔNG lưu (user chốt 01/10/2026).
 *
 * Chỉ THÊM trường vào `einvoice`. Không đụng collection khác. Mặc định dry-run.
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- node scripts/einvoice_schema_v2.mjs [--apply]
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const TARGET = 'einvoice';

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) { console.error('Thiếu tài khoản PocketBase (chạy qua railway run).'); process.exit(1); }

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};

const tmp = mkdtempSync(join(tmpdir(), 'einv2-'));
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (!auth?.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
const H = ['-H', `Authorization: ${auth.token}`];

const col = (curl([`${PB}/api/collections?perPage=500`, ...H]).items || []).find(c => c.name === TARGET);
if (!col) { console.error(`Không thấy collection ${TARGET} — chạy einvoice_schema.mjs trước.`); process.exit(1); }
const fields = col.fields ?? [];
const total = curl([`${PB}/api/collections/${TARGET}/records?perPage=1`, ...H]).totalItems;

const add = [
  { name: 'billval', type: 'text', required: false, presentable: false, min: 0, max: 500, pattern: '' },
  { name: 'ccis_department', type: 'number', required: false, presentable: false, onlyInt: true },
  { name: 'ccis_figure_book', type: 'number', required: false, presentable: false, onlyInt: true },
].filter(f => !fields.some(x => x.name === f.name));

console.log(`\nPB: ${PB}\n${TARGET}: ${total} bản ghi · ${fields.length} trường`);
if (!add.length) { console.log('= Đã có đủ 3 trường, không làm gì.'); process.exit(0); }
for (const f of add) console.log(`SẼ THÊM  ${f.name}:${f.type}`);
console.log('KHÔNG xoá/sửa trường nào, KHÔNG đổi dữ liệu, KHÔNG đụng collection khác.');
if (!APPLY) { console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.\n'); process.exit(0); }

const patchFile = join(mkdtempSync(join(tmpdir(), 'einv2p-')), 'patch.json');
fs.writeFileSync(patchFile, JSON.stringify({ fields: [...fields, ...add], indexes: col.indexes ?? [] }));
const res = curl(['-X', 'PATCH', `${PB}/api/collections/${col.id}`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${patchFile}`]);
rmSync(patchFile, { force: true });
const got = (res.fields ?? []).map(f => f.name);
if (!add.every(f => got.includes(f.name)) || got.length !== fields.length + add.length) {
  console.error('\nGHI XONG NHƯNG KIỂM LẠI KHÔNG ĐẠT:', JSON.stringify(res).slice(0, 400)); process.exit(1);
}
const total2 = curl([`${PB}/api/collections/${TARGET}/records?perPage=1`, ...H]).totalItems;
console.log(`\nOK — ${TARGET}: ${got.length} trường, ${total2} bản ghi (trước: ${total}).`);
