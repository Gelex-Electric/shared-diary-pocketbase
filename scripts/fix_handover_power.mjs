#!/usr/bin/env node
/**
 * Điền lại trực điều độ điện lực (main_power/sub_power) cho các ca bị trùng 2 ca liên tiếp
 * (user chốt 06/10/2026). Đối tượng:
 *  - ô điều độ đã để trống ở đợt sửa trùng ca (đọc từ các `fix_plan.csv` truyền qua --plan);
 *  - ô điều độ hiện còn trùng với ca liền trước.
 * Cách điền giống `src/lib/powerRotation.ts`: dò chu kỳ xoay P (ngày) của khu vực trong ±60 ngày,
 * lấy người cùng vai trò ở cùng ca cách k·P ngày (k = 1..6, trước rồi sau), bỏ qua ứng viên
 * trùng với ca liền trước/liền sau. Không tìm được → giữ nguyên (để trống).
 *
 * Mặc định dry-run. `--apply` ghi, sao lưu JSON bản ghi bị sửa vào `--out` trước.
 *   railway run -- node scripts/fix_handover_power.mjs --out <dir> --plan <csv> [--plan <csv>] [--apply]
 *
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const argv = process.argv;
const APPLY = argv.includes('--apply');
const OUT = argv[argv.indexOf('--out') + 1];
const PLANS = argv.flatMap((a, i) => a === '--plan' ? [argv[i + 1]] : []);
if (!argv.includes('--out') || !OUT) { console.error('Thiếu --out <thư-mục>'); process.exit(1); }
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

const norm = s => (s || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const POWER = ['main_power', 'sub_power'], ROLES = ['main_duty', 'sub_duty', ...POWER];
const addDays = (d, k) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const day = r => r.startdate.slice(0, 10);
const label = r => `${day(r)}|${r.shift}`;
const nextLabel = r => r.shift === 'Ca 1' ? `${day(r)}|Ca 2` : r.shift === 'Ca 2' ? `${day(r)}|Ca 3` : `${addDays(day(r), 1)}|Ca 1`;
const isAdj = (a, b) => a !== b && ((a.enddate && a.enddate === b.startdate) || nextLabel(a) === label(b));

/* Ô đã để trống ở đợt sửa trùng ca */
const targets = new Map(); // id -> Set(role)
for (const f of PLANS) for (const line of fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split('\n').slice(1)) {
  if (!line.trim()) continue;
  const c = line.slice(1, -1).split('","');
  if (POWER.includes(c[3]) && c[5] === '(để trống)') (targets.get(c[6]) ?? targets.set(c[6], new Set()).get(c[6])).add(c[3]);
}

const byArea = {};
for (const r of logs) (byArea[r.area] ??= []).push(r);
const byId = new Map(logs.map(r => [r.id, r]));

/* Ô điều độ hiện còn trùng ca liền trước */
for (const rs of Object.values(byArea)) for (const a of rs) for (const b of rs) {
  if (!isAdj(a, b)) continue;
  const prev = new Set(ROLES.map(r => norm(a[r])).filter(Boolean));
  for (const role of POWER) if (norm(b[role]) && prev.has(norm(b[role])))
    (targets.get(b.id) ?? targets.set(b.id, new Set()).get(b.id)).add(role);
}

const detectP = (hist) => {
  const m = new Map(hist.map(r => [label(r), r]));
  let best = null;
  for (let P = 1; P <= 14; P++) {
    let ok = 0, tot = 0;
    for (const r of hist) {
      if (!norm(r.main_power)) continue;
      const p = m.get(`${addDays(day(r), -P)}|${r.shift}`);
      if (!p || !norm(p.main_power)) continue;
      tot++;
      if (norm(p.main_power) === norm(r.main_power) && norm(p.sub_power) === norm(r.sub_power)) ok++;
    }
    if (tot < 6) continue;
    if (!best || ok / tot > best.rate + 0.02) best = { P, rate: ok / tot };
  }
  return best && best.rate >= 0.6 ? best : null;
};

/* Ô sai thường nằm ở CA LIỀN KỀ (vd ca trước ghi nhầm cặp của ca sau) → xét cả ca đích lẫn
   các ca kề nó. Mỗi ô lấy theo đa số phiếu của cùng ca cách ±k·P ngày (k = 1..3); chỉ sửa
   khi đa số rõ (≥ 2 phiếu và > nửa số phiếu) và khác giá trị hiện tại. */
const snapshot = new Map(logs.map(r => [r.id, structuredClone(r)])); // phiếu bầu dùng dữ liệu gốc
const consensus = (r, role, P) => {
  const m = new Map(byArea[r.area].filter(x => x.id !== r.id).map(x => [label(x), snapshot.get(x.id)]));
  const votes = new Map(), spell = new Map();
  let total = 0;
  for (let k = 1; k <= 3; k++) for (const dir of [-1, 1]) {
    const v = m.get(`${addDays(day(r), dir * k * P)}|${r.shift}`)?.[role];
    if (!norm(v)) continue;
    total++; votes.set(norm(v), (votes.get(norm(v)) || 0) + 1);
    if (!spell.has(norm(v))) spell.set(norm(v), v.trim());
  }
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 && top[1] > total / 2 ? spell.get(top[0]) : null;
};

const scope = new Map(); // id -> record (ca đích + ca kề)
for (const id of targets.keys()) {
  const r = byId.get(id); if (!r) continue;
  scope.set(id, r);
  for (const x of byArea[r.area]) if (isAdj(x, r) || isAdj(r, x)) scope.set(x.id, x);
}
const rows = [], patches = new Map();
for (const r of [...scope.values()].sort((a, b) => a.startdate.localeCompare(b.startdate))) {
  const rs = byArea[r.area];
  const hist = rs.filter(x => x.id !== r.id && day(x) >= addDays(day(r), -60) && day(x) <= addDays(day(r), 60));
  // Chỉ dùng chu kỳ dò được QUANH ca đó (±60 ngày); không lấy chu kỳ chung của cả năm —
  // giai đoạn dữ liệu lộn xộn (vd Tiền Hải T2–T4) áp chu kỳ chung sẽ sửa bừa.
  const det = detectP(hist);
  for (const role of POWER) {
    const pick = det ? consensus(r, role, det.P) : null;
    const isTarget = targets.get(r.id)?.has(role);
    if (pick ? norm(pick) === norm(r[role]) : !isTarget) continue;
    rows.push([r.area, r.startdate.slice(0, 16), r.shift, role, r[role] || '(trống)', pick || '(không tìm được)',
      det ? `P${det.P}` : '-', isTarget ? 'ô trùng' : 'ca kề lệch quy luật', r.id]);
    if (!pick) continue;
    (patches.get(r.id) ?? patches.set(r.id, { before: snapshot.get(r.id), patch: {} }).get(r.id)).patch[role] = pick;
    r[role] = pick;
  }
}

/* Kiểm lại: còn trùng ca liền kề ở vị trí điều độ không */
let remain = 0;
for (const rs of Object.values(byArea)) for (const a of rs) for (const b of rs) {
  if (!isAdj(a, b)) continue;
  const prev = new Set(ROLES.map(r => norm(a[r])).filter(Boolean));
  if (POWER.some(role => norm(b[role]) && prev.has(norm(b[role])))) { remain++; console.log('CÒN TRÙNG', b.area, b.startdate.slice(0, 16), b.shift, b.id); }
}
console.log('Còn trùng sau sửa (vị trí điều độ):', remain);

const csv = [['KhuVuc', 'BatDau', 'Ca', 'ViTri', 'Cu', 'Moi', 'ChuKy', 'LyDo', 'RecordId'], ...rows]
  .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
fs.writeFileSync(join(OUT, 'power_plan.csv'), '﻿' + csv);
for (const r of rows) console.log(r.slice(0, 8).join(' | '));
console.log(`\nÔ cần xét: ${[...targets.values()].reduce((s, x) => s + x.size, 0)} · điền được ${rows.filter(r => r[5] !== '(không tìm được)').length} · không tìm được ${rows.filter(r => r[5] === '(không tìm được)').length} · trên ${patches.size} ca`);
if (!APPLY) { console.log('DRY-RUN — chưa ghi. Thêm --apply để ghi.'); process.exit(0); }

const backup = join(OUT, `handovers_power_backup_${Date.now()}.json`);
fs.writeFileSync(backup, JSON.stringify([...patches.values()].map(c => c.before), null, 1));
console.log('Đã sao lưu:', backup);
let ok = 0;
const body = join(OUT, 'patch.tmp.json');
for (const [id, { patch }] of patches) {
  fs.writeFileSync(body, JSON.stringify(patch));
  const r = curl(['-X', 'PATCH', `${PB}/api/collections/handovers/records/${id}`, ...H,
    '-H', 'Content-Type: application/json', '--data-binary', `@${body}`]);
  if (r.id === id) ok++; else console.error('Lỗi', id, JSON.stringify(r).slice(0, 200));
}
fs.rmSync(body, { force: true });
console.log(`Đã ghi ${ok}/${patches.size} ca.`);
