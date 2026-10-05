#!/usr/bin/env node
/**
 * Lưu VĨNH VIỄN dữ liệu 30 phút về máy cục bộ, lấy từ LỊCH SỬ GIT.
 *
 * Vì sao: pipeline chỉ giữ `public/ChiSo_30min/` 30 ngày và
 * `public/ThongSo_30min/` 40 ngày, file quá hạn bị xoá. Nhưng mỗi đêm đều
 * commit, nên mọi ngày từng có vẫn nằm trong git. Script này đi ngược lịch sử
 * các nhánh, lấy BẢN MỚI NHẤT của từng file ngày và chép ra thư mục lưu trữ
 * ngoài repo. Chạy lại bao nhiêu lần cũng được: chỉ ghi file mới hoặc đổi nội
 * dung (pipeline tính lại ngày cũ thì bản lưu trữ cũng được cập nhật).
 *
 * Chỉ dùng thư viện có sẵn của Node + git. Chạy được trên PC lẫn laptop.
 *
 * Chạy (từ thư mục App):
 *   node scripts/archive_30min.mjs              # fetch rồi lưu
 *   node scripts/archive_30min.mjs --no-fetch   # bỏ git fetch
 *   node scripts/archive_30min.mjs --dry-run    # chỉ in, không ghi
 *
 * Env:
 *   ARCHIVE_DIR   thư mục đích. Mặc định `<ROOT>/10. App - Du lieu phu tro/Luu tru 30min`
 *                 (tính tương đối từ repo, không hard-code ổ đĩa).
 *   ARCHIVE_REFS  các nhánh quét, phân tách dấu phẩy. Mặc định `origin/main,origin/staging`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.ARCHIVE_DIR || join(APP, '..', '10. App - Du lieu phu tro', 'Luu tru 30min');
const REFS = (process.env.ARCHIVE_REFS || 'origin/main,origin/staging').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = process.argv.includes('--dry-run');
const FETCH = !process.argv.includes('--no-fetch');

/** Thư mục nguồn trong repo → thư mục con trong lưu trữ. `hes_30min` là tên cũ của ChiSo_30min (đổi 24/09/2026). */
const SOURCES = [
  { repo: 'public/ChiSo_30min', out: 'ChiSo_30min' },
  { repo: 'public/hes_30min', out: 'ChiSo_30min' },
  { repo: 'public/ThongSo_30min', out: 'ThongSo_30min' },
];
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.csv$/;

const git = (...args) => execFileSync('git', ['-C', APP, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
const gitBuf = (...args) => execFileSync('git', ['-C', APP, ...args], { maxBuffer: 1 << 30 });

if (FETCH) {
  console.log('git fetch origin …');
  git('fetch', '--quiet', 'origin');
}
const refs = REFS.filter((r) => {
  try { git('rev-parse', '--verify', '--quiet', r); return true; } catch { console.warn(`Bỏ qua ref không tồn tại: ${r}`); return false; }
});
if (!refs.length) { console.error('Không có ref nào để quét.'); process.exit(1); }

// Commit mới → cũ (theo thời gian commit, gộp mọi nhánh). Bản gặp ĐẦU TIÊN của
// mỗi file là bản mới nhất ⇒ giữ nó.
const commits = git('log', '--format=%H %ct', ...refs, '--', ...SOURCES.map((s) => s.repo))
  .trim().split('\n').filter(Boolean)
  .map((l) => { const [h, t] = l.split(' '); return { h, t: Number(t) }; })
  .sort((a, b) => b.t - a.t);

/** key `out/YYYY-MM-DD.csv` → blob sha */
const latest = new Map();
for (const { h } of commits) {
  for (const src of SOURCES) {
    let tree;
    try { tree = git('ls-tree', h, `${src.repo}/`); } catch { continue; }
    for (const line of tree.trim().split('\n')) {
      const m = line.match(/^\d+ blob ([0-9a-f]+)\t.*\/([^/]+)$/);
      if (!m || !DAY_FILE.test(m[2])) continue;
      const key = `${src.out}/${m[2]}`;
      if (!latest.has(key)) latest.set(key, m[1]);
    }
  }
}

// Sổ ghi blob đã lưu, để lần sau chỉ ghi file mới/đổi.
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

let added = 0, updated = 0, same = 0;
for (const key of [...latest.keys()].sort()) {
  const sha = latest.get(key);
  const dest = join(OUT, key);
  if (manifest[key] === sha && existsSync(dest)) { same++; continue; }
  const isNew = !existsSync(dest);
  isNew ? added++ : updated++;
  console.log(`${isNew ? '+' : '~'} ${key}`);
  if (DRY) continue;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, gitBuf('cat-file', 'blob', sha));
  manifest[key] = sha;
}
if (!DRY && (added || updated)) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

const byDir = {};
for (const k of latest.keys()) { const d = k.split('/')[0]; (byDir[d] ||= []).push(k.split('/')[1]); }
for (const [d, files] of Object.entries(byDir)) {
  files.sort();
  console.log(`${d}: ${files.length} ngày (${files[0].slice(0, 10)} → ${files.at(-1).slice(0, 10)})`);
}
console.log(`${DRY ? '[dry-run] ' : ''}Thêm ${added}, cập nhật ${updated}, giữ nguyên ${same} → ${OUT}`);
