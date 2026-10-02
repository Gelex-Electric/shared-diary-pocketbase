#!/usr/bin/env node
/**
 * Tạo collection `einvoice` — HÓA ĐƠN ĐIỆN TỬ gốc (plan 2026-10-01-tach-invoice.md).
 *
 * MỘT bản ghi = MỘT hóa đơn = MỘT file XML tải lên ở màn "Nạp dữ liệu". Nối với
 * `invoice` (chi tiết chỉ số / thành tiền, GIỮ NGUYÊN) bằng `BillId`: một hóa đơn có
 * nhiều công tơ / khoảng giá ⇒ nhiều dòng `invoice` cùng `BillId` (quan hệ 1–N).
 *
 * Khóa duy nhất: `BillId` và `MaTraCuu` (Fkey = BillId + 5 ký tự). KHÔNG dùng số hóa
 * đơn: hai công ty bán (GELEX 0109975082 / GELEX Hưng Yên 0110199765) dùng chung dãy
 * số — 9 số trùng trong 75 file mẫu ngày 01/10/2026.
 *
 * Rule giống `invoice`: xem theo `area2`, ghi chỉ khối Kinh doanh (`area2` rỗng).
 *
 * Chỉ TẠO collection mới. Không đụng collection nào khác. Mặc định dry-run.
 * Gọi mạng bằng `curl` (mạng công ty chặn cert của Node).
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- \
 *     node scripts/einvoice_schema.mjs            # xem trước, KHÔNG ghi
 *   ... node scripts/einvoice_schema.mjs --apply  # ghi thật
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
const NAME = 'einvoice';

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
const tmp = mkdtempSync(join(tmpdir(), 'einv-'));
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

const cols = curl([`${PB}/api/collections?perPage=500`, ...H]).items || [];
/* SQLite không phân biệt hoa/thường ở tên bảng — soát cả kiểu viết khác. */
const clash = cols.find(c => c.name.toLowerCase() === NAME);
if (clash) { console.log(`= Đã có collection "${clash.name}", không làm gì.`); process.exit(0); }
const inv = cols.find(c => c.name === 'invoice');
if (!inv) { console.error('Không thấy collection invoice để chép rule.'); process.exit(1); }
const invTotal = curl([`${PB}/api/collections/invoice/records?perPage=1`, ...H]).totalItems;

const text = (name, max = 255) => ({ name, type: 'text', required: false, presentable: false, min: 0, max, pattern: '' });
const num = (name) => ({ name, type: 'number', required: false, presentable: false, onlyInt: false });
const date = (name) => ({ name, type: 'date', required: false, presentable: false });

const fields = [
  text('BillId', 32),
  text('LoaiHD', 8),                      // HC / VC (BillType của XML: TD → HC)
  num('Year'), num('Month'), num('Term'),
  date('StartDate'), date('EndDate'),
  text('KHMSHDon', 8), text('KHHDon', 16), text('SHDon', 16),
  date('NLap'),
  text('MCCQT', 64),
  text('MaTraCuu', 64),                   // Fkey — "Mã nhận HĐ" ở cổng tra cứu HILO
  text('MSTNBan', 20), text('NBan', 255),
  text('MKHang', 64), text('NMua', 500),
  num('TgTTTBSo'),
  text('xml_name', 255),
  text('xml', 500000),                    // toàn văn file XML (mẫu ~24 KB)
  { name: 'mail_status', type: 'select', required: false, presentable: false,
    maxSelect: 1, values: ['chua_gui', 'da_gui', 'loi'] },
  date('mail_sent_at'),
  text('mail_to', 1000),
  text('mail_error', 1000),
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];
const indexes = [
  'CREATE UNIQUE INDEX `idx_einvoice_billid` ON `einvoice` (`BillId`)',
  'CREATE UNIQUE INDEX `idx_einvoice_matracuu` ON `einvoice` (`MaTraCuu`)',
  'CREATE INDEX `idx_einvoice_mkhang` ON `einvoice` (`MKHang`)',
];
const body = {
  name: NAME, type: 'base', fields, indexes,
  listRule: inv.listRule, viewRule: inv.viewRule,
  createRule: inv.createRule, updateRule: inv.updateRule, deleteRule: inv.deleteRule,
};

console.log(`\nPB: ${PB}`);
console.log(`SẼ TẠO   ${NAME}: ${fields.length} trường`);
console.log('         ' + fields.map(f => `${f.name}:${f.type}`).join(', '));
console.log(`         index: ${indexes.map(i => i.match(/`(idx_[^`]+)`/)[1]).join(', ')}`);
console.log(`         rule chép từ invoice: list=${inv.listRule}`);
console.log(`         create/update/delete=${inv.createRule}`);
console.log(`KHÔNG đụng collection khác. invoice hiện ${invTotal} bản ghi.`);

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

const bodyFile = join(mkdtempSync(join(tmpdir(), 'einvp-')), 'body.json');
fs.writeFileSync(bodyFile, JSON.stringify(body));
const res = curl(['-X', 'POST', `${PB}/api/collections`,
  '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${bodyFile}`]);
rmSync(bodyFile, { force: true });

const got = (res.fields ?? []).map(f => f.name);
const ok = res.name === NAME && fields.every(f => got.includes(f.name))
  && (res.indexes ?? []).length === indexes.length
  && res.listRule === inv.listRule && res.createRule === inv.createRule;
if (!ok) { console.error('\nGHI XONG NHƯNG KIỂM LẠI KHÔNG ĐẠT:', JSON.stringify(res).slice(0, 600)); process.exit(1); }
const invTotal2 = curl([`${PB}/api/collections/invoice/records?perPage=1`, ...H]).totalItems;
console.log(`\nOK — tạo ${NAME} (id ${res.id}): ${got.length} trường, ${res.indexes.length} index. invoice vẫn ${invTotal2} bản ghi.`);
