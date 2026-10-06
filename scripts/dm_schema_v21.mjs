#!/usr/bin/env node
/**
 * Schema đợt 21 — lịch trực tháng (user duyệt plan 06/10/2026, `plans/2026-10-06-lich-truc-thang.md`).
 *
 * TẠO MỚI 2 collection, không sửa collection nào có sẵn:
 *  - `shift_roster`: 1 bản ghi = 1 ca (area + date `YYYY-MM-DD` + shift) + 4 tên trực.
 *    Index UNIQUE (area, date, shift) — chặn 2 bản ghi cho cùng một ca ở tầng DB.
 *    Quyền: chép nguyên 5 rule của `handovers`.
 *  - `power_staff`: danh sách điều độ điện lực (area, Name, IDnum) — cùng khuôn `Electric_shift`,
 *    chép nguyên 5 rule của `Electric_shift`.
 * `area` là select, chép nguyên danh sách giá trị của `handovers.area`.
 *
 * Mặc định dry-run. Gọi mạng bằng `curl`. Chụp JSON 9 collection bảo vệ trước/sau và so khớp.
 *   railway run -- node scripts/dm_schema_v21.mjs            # xem trước, KHÔNG ghi
 *   railway run -- node scripts/dm_schema_v21.mjs --apply    # ghi thật
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

/* Danh sách collection KHÔNG được đụng tới — giữ nguyên như các đợt schema trước. */
const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];
const NEW = ['shift_roster', 'power_staff'];
if (NEW.some(n => PROTECTED.includes(n))) { console.error('Đụng collection được bảo vệ'); process.exit(1); }

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
const tmp = mkdtempSync(join(tmpdir(), 'dmv21-'));
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

const cols = listCols();
const before = snap(cols);
const ho = cols.find(c => c.name === 'handovers'), es = cols.find(c => c.name === 'Electric_shift');
if (!ho || !es) { console.error('Không thấy handovers / Electric_shift'); process.exit(1); }
const areaField = (ho.fields ?? []).find(f => f.name === 'area');
const shiftField = (ho.fields ?? []).find(f => f.name === 'shift');
const rules = c => ({ listRule: c.listRule, viewRule: c.viewRule, createRule: c.createRule, updateRule: c.updateRule, deleteRule: c.deleteRule });
const text = (name, max = 200) => ({ name, type: 'text', required: false, presentable: false, min: 0, max, pattern: '' });
const sel = (f, required = true) => ({ name: f.name, type: 'select', required, presentable: false, maxSelect: 1, values: [...f.values] });
const autodates = [
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];

const defs = {
  shift_roster: {
    name: 'shift_roster', type: 'base', ...rules(ho),
    fields: [sel(areaField), { ...text('date', 10), required: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, sel(shiftField),
      text('main_duty'), text('sub_duty'), text('main_power'), text('sub_power'), ...autodates],
    indexes: ['CREATE UNIQUE INDEX `idx_shift_roster_slot` ON `shift_roster` (`area`, `date`, `shift`)'],
  },
  power_staff: {
    name: 'power_staff', type: 'base', ...rules(es),
    fields: [sel(areaField), { ...text('Name'), required: true }, { name: 'IDnum', type: 'number', required: false, presentable: false, onlyInt: true }, ...autodates],
    indexes: ['CREATE UNIQUE INDEX `idx_power_staff_name` ON `power_staff` (`area`, `Name`)'],
  },
};

console.log(`\nPB: ${PB}`);
console.log(`area = select [${areaField.values.join(', ')}] · shift = [${shiftField.values.join(', ')}]`);
console.log(`Quyền shift_roster ← handovers: ${JSON.stringify(rules(ho))}`);
console.log(`Quyền power_staff  ← Electric_shift: ${JSON.stringify(rules(es))}`);
const todo = NEW.filter(n => !cols.some(c => c.name === n));
for (const n of NEW) console.log(todo.includes(n) ? `SẼ TẠO  ${n}: ${defs[n].fields.map(f => f.name).join(', ')} · ${defs[n].indexes.join('; ')}` : `= Đã có ${n}, bỏ qua.`);
if (!todo.length) process.exit(0);
console.log('KHÔNG sửa/xoá collection nào có sẵn.');

if (!APPLY) {
  console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('⚠️  staging và production dùng CHUNG PocketBase — chạy một lần áp cho cả hai.\n');
  process.exit(0);
}

for (const n of todo) {
  const f = join(mkdtempSync(join(tmpdir(), 'dmv21c-')), 'col.json');
  fs.writeFileSync(f, JSON.stringify(defs[n]));
  const res = curl(['-X', 'POST', `${PB}/api/collections`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${f}`]);
  rmSync(f, { force: true });
  if (res.name !== n) { console.error(`Tạo ${n} thất bại:`, JSON.stringify(res).slice(0, 500)); process.exit(1); }
  console.log(`OK — tạo ${n} (${res.id}): ${(res.fields ?? []).map(x => x.name).join(', ')} · ${(res.indexes ?? []).length} index`);
}

const after = snap(listCols());
if (after !== before) { console.error('\n⚠️  9 collection bảo vệ BỊ THAY ĐỔI — kiểm tra ngay!'); process.exit(1); }
console.log('\nKiểm lại: 9 collection bảo vệ không đổi.');
