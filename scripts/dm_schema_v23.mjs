#!/usr/bin/env node
/**
 * Schema đợt 23 — luồng cấp vật tư cho điểm đo mới (user duyệt 26/10/2026,
 * `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md` mục 4).
 *
 * CHỈ THÊM, không xoá/đổi trường nào có sẵn, không đụng dữ liệu:
 *  - `dm_point`  + `need` (json — dòng nhu cầu vật tư), `urgent` (bool), `needed_by` (date)
 *  - `dm_device` + `shape` (select tron|vuong — hình dạng TI), `purchase_line` (relation)
 *  - TẠO `dm_purchase` (đơn mua), `dm_purchase_line` (dòng đơn), `dm_borrow` (sổ mượn)
 * Rule 3 collection mới chép nguyên 5 rule của `dm_device`.
 *
 * Mặc định dry-run. Gọi mạng bằng `curl`. 8 collection bảo vệ + `users` phải không đổi.
 *   railway run -- node scripts/dm_schema_v23.mjs            # xem trước, KHÔNG ghi
 *   railway run -- node scripts/dm_schema_v23.mjs --apply    # ghi thật
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
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

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
const tmp = mkdtempSync(join(tmpdir(), 'dmv23-'));
const authFile = join(tmp, 'auth.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (!auth?.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
const H = ['-H', `Authorization: ${auth.token}`];

const send = (method, path, body) => {
  const f = join(mkdtempSync(join(tmpdir(), 'dmv23c-')), 'body.json');
  fs.writeFileSync(f, JSON.stringify(body));
  try {
    return curl(['-X', method, `${PB}${path}`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${f}`]);
  } finally { rmSync(f, { force: true }); }
};

const listCols = () => curl([`${PB}/api/collections?perPage=500`, ...H]).items || [];
const snap = cols => JSON.stringify(PROTECTED.map(n => cols.find(c => c.name === n) ?? null)
  .map(c => c && { ...c, updated: undefined }));
/** Collection bỏ các trường sắp thêm — phải giống hệt trước và sau khi ghi. */
const sansNew = (c, names) => JSON.stringify({ ...c, updated: undefined, fields: (c.fields ?? []).filter(f => !names.includes(f.name)) });

/* ------------------------------ định nghĩa ------------------------------ */
const text = (name, max = 200, required = false) => ({ name, type: 'text', required, presentable: false, min: 0, max, pattern: '' });
const num = (name, onlyInt = false) => ({ name, type: 'number', required: false, presentable: false, onlyInt });
const date = name => ({ name, type: 'date', required: false, presentable: false });
const bool = name => ({ name, type: 'bool', required: false, presentable: false });
const rel = (name, collectionId, { required = false, cascadeDelete = false } = {}) =>
  ({ name, type: 'relation', required, presentable: false, collectionId, cascadeDelete, maxSelect: 1, minSelect: 0 });
const shapeField = () => ({ name: 'shape', type: 'select', required: false, presentable: false, maxSelect: 1, values: ['tron', 'vuong'] });
const typeField = () => ({ name: 'type', type: 'select', required: true, presentable: false, maxSelect: 1,
  values: ['CONGTO', 'GP03', 'TI', 'TU', 'SIM', 'KHAC'] });
const autodates = [
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];
const rules = c => ({ listRule: c.listRule, viewRule: c.viewRule, createRule: c.createRule, updateRule: c.updateRule, deleteRule: c.deleteRule });

const NEW_POINT = ['need', 'urgent', 'needed_by'];
const NEW_DEVICE = ['shape', 'purchase_line'];

/* -------------------------------- hiện trạng -------------------------------- */
let cols = listCols();
const before = snap(cols);
const point = cols.find(c => c.name === 'dm_point');
const device = cols.find(c => c.name === 'dm_device');
if (!point || !device) { console.error('Không thấy dm_point / dm_device'); process.exit(1); }
const pointBefore = sansNew(point, NEW_POINT);
const deviceBefore = sansNew(device, NEW_DEVICE);
const typeOnDevice = device.fields.find(f => f.name === 'type');
if (typeOnDevice?.values) typeField().values.forEach(v => {
  if (!typeOnDevice.values.includes(v)) { console.error(`dm_device.type không có giá trị ${v}`); process.exit(1); }
});

console.log(`\nPB: ${PB}`);
console.log(`Quyền 3 collection mới ← dm_device: ${JSON.stringify(rules(device))}`);
const has = n => cols.some(c => c.name === n);
const plan = [
  has('dm_purchase') ? '= Đã có dm_purchase' : 'SẼ TẠO  dm_purchase: code, ordered_at, supplier, expected_at, cancelled, note',
  has('dm_purchase_line') ? '= Đã có dm_purchase_line' : 'SẼ TẠO  dm_purchase_line: purchase (cascade), type, ratio_primary, ratio_secondary, shape, qty, for_point, note',
  has('dm_borrow') ? '= Đã có dm_borrow' : 'SẼ TẠO  dm_borrow: device, from_point, to_point, borrowed_at, reason, settled_at',
  ...NEW_POINT.map(n => point.fields.some(f => f.name === n) ? `= Đã có dm_point.${n}` : `SẼ THÊM dm_point.${n}`),
  ...NEW_DEVICE.map(n => device.fields.some(f => f.name === n) ? `= Đã có dm_device.${n}` : `SẼ THÊM dm_device.${n}`),
];
plan.forEach(l => console.log(l));
if (plan.every(l => l.startsWith('='))) process.exit(0);
console.log('KHÔNG sửa/xoá trường, rule hay dữ liệu nào có sẵn.');

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

/* ---------------------------------- ghi ---------------------------------- */
const create = (def) => {
  const res = send('POST', '/api/collections', def);
  if (res.name !== def.name) { console.error(`Tạo ${def.name} thất bại:`, JSON.stringify(res).slice(0, 500)); process.exit(1); }
  console.log(`OK — tạo ${def.name} (${res.id}): ${(res.fields ?? []).map(x => x.name).join(', ')}`);
  return res;
};

let purchase = cols.find(c => c.name === 'dm_purchase');
if (!purchase) purchase = create({
  name: 'dm_purchase', type: 'base', ...rules(device),
  fields: [text('code', 50, true), date('ordered_at'), text('supplier'), date('expected_at'), bool('cancelled'), text('note', 2000), ...autodates],
  indexes: ['CREATE UNIQUE INDEX `idx_dm_purchase_code` ON `dm_purchase` (`code`)'],
});
let pline = cols.find(c => c.name === 'dm_purchase_line');
if (!pline) pline = create({
  name: 'dm_purchase_line', type: 'base', ...rules(device),
  fields: [rel('purchase', purchase.id, { required: true, cascadeDelete: true }), typeField(),
    num('ratio_primary'), num('ratio_secondary'), shapeField(), { ...num('qty', true), required: true },
    rel('for_point', point.id), text('note', 2000), ...autodates],
  indexes: ['CREATE INDEX `idx_dm_purchase_line_purchase` ON `dm_purchase_line` (`purchase`)'],
});
if (!cols.some(c => c.name === 'dm_borrow')) create({
  name: 'dm_borrow', type: 'base', ...rules(device),
  fields: [rel('device', device.id, { required: true }), rel('from_point', point.id, { required: true }),
    rel('to_point', point.id, { required: true }), date('borrowed_at'), text('reason', 2000), date('settled_at'), ...autodates],
  indexes: ['CREATE INDEX `idx_dm_borrow_from` ON `dm_borrow` (`from_point`)'],
});

/* PATCH phải gửi đủ danh sách trường cũ (kèm id) — thiếu trường nào là PocketBase xoá trường đó. */
const addFields = (col, add) => {
  const missing = add.filter(f => !col.fields.some(x => x.name === f.name));
  if (!missing.length) return;
  const res = send('PATCH', `/api/collections/${col.id}`, { fields: [...col.fields, ...missing] });
  if (!missing.every(m => (res.fields ?? []).some(x => x.name === m.name))) {
    console.error(`Thêm trường vào ${col.name} thất bại:`, JSON.stringify(res).slice(0, 500)); process.exit(1);
  }
  console.log(`OK — ${col.name} thêm ${missing.map(m => m.name).join(', ')}`);
};
addFields(point, [{ name: 'need', type: 'json', required: false, presentable: false, maxSize: 0 }, bool('urgent'), date('needed_by')]);
addFields(device, [shapeField(), rel('purchase_line', pline.id)]);

/* -------------------------------- kiểm lại -------------------------------- */
cols = listCols();
if (snap(cols) !== before) { console.error('\n⚠️  Collection bảo vệ BỊ THAY ĐỔI — kiểm tra ngay!'); process.exit(1); }
if (sansNew(cols.find(c => c.name === 'dm_point'), NEW_POINT) !== pointBefore) { console.error('\n⚠️  dm_point đổi ngoài trường mới!'); process.exit(1); }
if (sansNew(cols.find(c => c.name === 'dm_device'), NEW_DEVICE) !== deviceBefore) { console.error('\n⚠️  dm_device đổi ngoài trường mới!'); process.exit(1); }
console.log('\nKiểm lại: dm_point/dm_device chỉ thêm trường mới; collection bảo vệ không đổi.');
