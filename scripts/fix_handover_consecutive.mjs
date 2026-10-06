#!/usr/bin/env node
/**
 * Sửa các ca `handovers` có người trực 2 ca liên tiếp (user chốt 06/10/2026).
 *
 * Trong từng khu vực, xét các ca kề nhau (enddate ca trước = startdate ca sau). Ở ca SAU:
 *  - trực đội (main_duty/sub_duty) trùng người ca trước → thay bằng người theo thuật toán
 *    phân ca tự động MỚI (`HandoverManager.handleAutoAssign`, monthOffset = getMonth());
 *    nếu người đó cũng vướng (ca trước/ca sau/ô còn lại) thì lấy người kế tiếp trong vòng xoay.
 *  - điều độ điện lực (main_power/sub_power) trùng → để trống.
 *
 * Mặc định dry-run (chỉ in + ghi CSV). `--apply` mới ghi; trước khi ghi sao lưu JSON
 * toàn bộ bản ghi bị sửa vào `--out`. Gọi mạng bằng `curl`.
 *
 *   railway run -- node scripts/fix_handover_consecutive.mjs --out <thư-mục> [--apply]
 *
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';

process.env.TZ = 'Asia/Ho_Chi_Minh';
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const OUT = process.argv[process.argv.indexOf('--out') + 1];
if (!process.argv.includes('--out') || !OUT) { console.error('Thiếu --out <thư-mục>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) { console.error('Thiếu tài khoản PocketBase (chạy qua `railway run`).'); process.exit(1); }

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '120', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  try { return JSON.parse(out); } catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};

/* Mật khẩu đi qua FILE tạm, không qua dòng lệnh. */
const authFile = join(OUT, 'auth.tmp.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally { fs.rmSync(authFile, { force: true }); }
if (!auth?.token) { console.error('Đăng nhập thất bại'); process.exit(1); }
const H = ['-H', `Authorization: ${auth.token}`];

const getAll = (col, q = '') => {
  const all = [];
  for (let page = 1; ; page++) {
    const r = curl([`${PB}/api/collections/${col}/records?perPage=500&page=${page}${q}`, ...H]);
    all.push(...r.items);
    if (page >= r.totalPages) return all;
  }
};
const logs = getAll('handovers');
const staff = getAll('Electric_shift');

const norm = s => (s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const DUTY = ['main_duty', 'sub_duty'], POWER = ['main_power', 'sub_power'], ROLES = [...DUTY, ...POWER];
const SLOT = { 'Ca 1': 0, 'Ca 2': 2, 'Ca 3': 4 };

/* Vòng xoay giống handleAutoAssign (đã sửa monthOffset). */
const rotated = (area, dateStr) => {
  const list = staff.filter(s => s.area === area).sort((a, b) => a.IDnum - b.IDnum);
  if (list.length === 0) return [];
  const date = new Date(dateStr);
  const dayIndex = Math.floor((date.getTime() - new Date(2026, 0, 1).getTime()) / 864e5);
  const rot = Math.abs(dayIndex + date.getMonth()) % list.length;
  return [...list.slice(rot), ...list.slice(0, rot)].map(s => s.Name);
};

const byArea = {};
for (const r of logs) (byArea[r.area] ??= []).push(r);

const changes = new Map(); // id -> { before, patch }
const rows = [];
for (const [area, rs] of Object.entries(byArea)) {
  rs.sort((a, b) => a.startdate.localeCompare(b.startdate));
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1], b = rs[i];
    if (a.enddate !== b.startdate) continue;
    const c = rs[i + 1]?.startdate === b.enddate ? rs[i + 1] : null;
    const prev = new Set(ROLES.map(r => norm(a[r])).filter(Boolean));
    for (const role of ROLES) {
      const cur = b[role];
      if (!norm(cur) || !prev.has(norm(cur))) continue;
      let next = '';
      if (DUTY.includes(role)) {
        const busy = new Set([...prev, ...(c ? ROLES.map(r => norm(c[r])) : []),
          ...ROLES.filter(r => r !== role).map(r => norm(b[r]))].filter(Boolean));
        const order = rotated(area, b.startdate.slice(0, 10));
        const k = (SLOT[b.shift] ?? 0) + DUTY.indexOf(role);
        for (let j = 0; j < order.length; j++) {
          const cand = order[(k + j) % order.length];
          if (!busy.has(norm(cand))) { next = cand; break; }
        }
      }
      if (!changes.has(b.id)) changes.set(b.id, { before: structuredClone(b), patch: {} });
      changes.get(b.id).patch[role] = next;
      rows.push([area, b.startdate.slice(0, 16), b.shift, role, cur, next || '(để trống)', b.id]);
      b[role] = next; // cập nhật tại chỗ để cặp (b, c) xét tiếp trên dữ liệu mới
    }
  }
}

const csv = [['KhuVuc', 'BatDau', 'Ca', 'ViTri', 'Cu', 'Moi', 'RecordId'], ...rows]
  .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
fs.writeFileSync(join(OUT, 'fix_plan.csv'), '﻿' + csv);
console.log(`Bản ghi: ${logs.length} · thay đổi ${rows.length} vị trí trên ${changes.size} ca`);
console.log(`Thay người trực đội: ${rows.filter(r => DUTY.includes(r[3]) && r[5] !== '(để trống)').length}`
  + ` · để trống: ${rows.filter(r => r[5] === '(để trống)').length}`);

if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

const backup = join(OUT, `handovers_backup_${Date.now()}.json`);
fs.writeFileSync(backup, JSON.stringify([...changes.values()].map(c => c.before), null, 1));
console.log('Đã sao lưu:', backup);
let ok = 0;
for (const [id, { patch }] of changes) {
  const body = join(OUT, 'patch.tmp.json');
  fs.writeFileSync(body, JSON.stringify(patch));
  const r = curl(['-X', 'PATCH', `${PB}/api/collections/handovers/records/${id}`, ...H,
    '-H', 'Content-Type: application/json', '--data-binary', `@${body}`]);
  if (r.id === id) ok++; else console.error('Lỗi', id, JSON.stringify(r).slice(0, 200));
}
fs.rmSync(join(OUT, 'patch.tmp.json'), { force: true });
console.log(`Đã ghi ${ok}/${changes.size} ca.`);
