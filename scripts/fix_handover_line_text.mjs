#!/usr/bin/env node
/**
 * Thống nhất câu kiểm tra đường dây trong `handovers` (user chốt 06/10/2026):
 *   "Kiểm tra ĐZ trung thế đi KCN Số 03" / "Kiểm tra đường dây trung thế 22kV đi KCN Thuận Thành I"
 *   / "Kiểm tra đường dây trung thế đi KCN Yên Mỹ, hoạt động bình thường"
 *   → "Kiểm tra đường dây KCN <tên>"
 * Giữ nguyên dấu "- " đầu dòng và phần văn bản khác. Quét `situations[].content`, `notes`,
 * `equipment`, `opinions`.
 *
 * Mặc định dry-run. `--apply` ghi, sao lưu JSON bản ghi bị sửa vào `--out` trước.
 *   railway run -- node scripts/fix_handover_line_text.mjs --out <thư-mục> [--apply]
 *
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';

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
const authFile = join(OUT, 'auth.tmp.json');
fs.writeFileSync(authFile, JSON.stringify({ identity: email, password }));
let auth;
try {
  auth = curl(['-X', 'POST', `${PB}/api/collections/_superusers/auth-with-password`,
    '-H', 'Content-Type: application/json', '--data-binary', `@${authFile}`]);
} finally { fs.rmSync(authFile, { force: true }); }
if (!auth?.token) { console.error('Đăng nhập thất bại'); process.exit(1); }
const H = ['-H', `Authorization: ${auth.token}`];

const logs = [];
for (let page = 1; ; page++) {
  const r = curl([`${PB}/api/collections/handovers/records?perPage=500&page=${page}`, ...H]);
  logs.push(...r.items);
  if (page >= r.totalPages) break;
}

/* Cần có "trung thế" hoặc "đi" — câu đã đúng chuẩn ("Kiểm tra đường dây KCN X") không khớp. */
const RE = /Kiểm tra (?:đường dây|ĐZ)((?: trung thế)?(?: 22kV)?(?: đi)?) (KCN [^,.;\n\t]+?)(?:\s*,\s*hoạt động bình thường)?(?=\s*[.,;\n]|\s*$|\s+-)/giu;
const fix = s => typeof s !== 'string' ? s
  : s.normalize('NFC').replace(RE, (m, mid, kcn) => mid.trim() ? `Kiểm tra đường dây ${kcn.trim()}` : m);

const changes = [], pairs = {};
for (const r of logs) {
  const patch = {};
  for (const f of ['notes', 'equipment', 'opinions']) {
    const v = fix(r[f]);
    if (v !== r[f] && v !== r[f]?.normalize('NFC')) { patch[f] = v; pairs[`${r[f]} → ${v}`] = (pairs[`${r[f]} → ${v}`] || 0) + 1; }
  }
  if (Array.isArray(r.situations)) {
    let changed = false;
    const sit = r.situations.map(s => {
      const v = fix(s.content);
      if (v !== s.content && v !== s.content?.normalize('NFC')) {
        changed = true; const k = `${s.content} → ${v}`; pairs[k] = (pairs[k] || 0) + 1;
        return { ...s, content: v };
      }
      return s;
    });
    if (changed) patch.situations = sit;
  }
  if (Object.keys(patch).length) changes.push({ before: r, id: r.id, patch });
}

for (const [k, v] of Object.entries(pairs).sort((a, b) => b[1] - a[1])) console.log(v, '|', k.slice(0, 260));
console.log(`\nBản ghi: ${logs.length} · cần sửa ${changes.length} ca`);
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

const backup = join(OUT, `handovers_text_backup_${Date.now()}.json`);
fs.writeFileSync(backup, JSON.stringify(changes.map(c => c.before), null, 1));
console.log('Đã sao lưu:', backup);
let ok = 0;
const body = join(OUT, 'patch.tmp.json');
for (const { id, patch } of changes) {
  fs.writeFileSync(body, JSON.stringify(patch));
  const r = curl(['-X', 'PATCH', `${PB}/api/collections/handovers/records/${id}`, ...H,
    '-H', 'Content-Type: application/json', '--data-binary', `@${body}`]);
  if (r.id === id) ok++; else console.error('Lỗi', id, JSON.stringify(r).slice(0, 200));
}
fs.rmSync(body, { force: true });
console.log(`Đã ghi ${ok}/${changes.length} ca.`);
