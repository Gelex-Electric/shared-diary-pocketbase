#!/usr/bin/env node
/**
 * Bản TS (`src/lib/thongso.ts`) và bản Node (`scripts/lib/thongso.mjs`) phải cho
 * ra số GIỐNG HỆT nhau. Script này chạy cả hai trên dữ liệu THẬT rồi so từng ô.
 *
 * Vì sao cần: hai bản là hai bản chép tay của cùng một luật (nhân HSN cho trường
 * nào, tra lần treo nào). Lệch một cờ `scaled` là app hiện một đằng, pipeline
 * tính một nẻo, mà không chỗ nào báo lỗi — sai lặng lẽ, đúng kiểu khó tìm nhất.
 *
 * CHỈ ĐỌC file trong repo. Không mạng, không PocketBase.
 *
 *   node scripts/check_thongso_parity.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import * as mjs from './lib/thongso.mjs';

/* Bản TS: bóc kiểu bằng esbuild (vite đã kéo sẵn) rồi nạp như module thường. */
const esbuild = await import('esbuild');
const src = readFileSync('src/lib/thongso.ts', 'utf8');
const js = (await esbuild.transform(src, { loader: 'ts', format: 'esm' })).code;
const dir = mkdtempSync(join(tmpdir(), 'thongso-'));
const file = join(dir, 'thongso.mjs');
writeFileSync(file, js, 'utf8');
const ts = await import(pathToFileURL(file).href);

let fail = 0;
const bad = (msg) => { console.log('  ✘', msg); fail++; };

/* ---------------- 1. Danh sách cột và cờ nhân HSN phải trùng ---------------- */
const colsMjs = mjs.THONGSO_COLUMNS.join(',');
const colsTs = ts.THONGSO_COLUMNS.join(',');
console.log('1) Danh sách cột');
if (colsMjs !== colsTs) bad(`cột lệch:\n     mjs: ${colsMjs}\n     ts : ${colsTs}`);
else console.log(`  ✔ khớp (${ts.THONGSO_COLUMNS.length} cột)`);

const flagMjs = mjs.THONGSO_FIELDS.map(f => `${f[0]}:${f[2] ? 1 : 0}`).join(' ');
const flagTs = ts.THONGSO_FIELDS.map(f => `${f[0]}:${f[1] ? 1 : 0}`).join(' ');
console.log('2) Cờ "có nhân HSN"');
if (flagMjs !== flagTs) bad(`cờ lệch:\n     mjs: ${flagMjs}\n     ts : ${flagTs}`);
else console.log(`  ✔ khớp — không nhân: ${ts.THONGSO_FIELDS.filter(f => !f[1]).map(f => f[0]).join(', ')}`);

/* ------------------- 3. scaleRow trên DỮ LIỆU THẬT ------------------- */
console.log('3) scaleRow trên dữ liệu thật');
const DIR = 'public/ThongSo_30min';
const days = readdirSync(DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort();
if (!days.length) { bad('không có file ngày nào để thử'); }
else {
  const day = days[days.length - 1];
  const rows = ts.parseThongSoCsv(readFileSync(join(DIR, day), 'utf8'));
  /* HSN thật đang dùng, gồm cả 1 (đấu thẳng) và 8800 (đầu nguồn có TU). */
  const HSNS = [1, 30, 40, 200, 320, 800, 3000, 8800];
  let cells = 0, diff = 0;
  for (const row of rows) {
    for (const hsn of HSNS) {
      const a = mjs.scaleRow(row, hsn);
      const b = ts.scaleRow(row, hsn);
      for (const k of Object.keys(a)) {
        cells++;
        if (!Object.is(a[k], b[k])) {
          if (diff < 5) bad(`${row.METER_NO} ${row.DATE_TIME} HSN=${hsn} cột ${k}: mjs=${a[k]} ts=${b[k]}`);
          diff++;
        }
      }
    }
  }
  console.log(`  ${diff ? '✘' : '✔'} ${day}: ${rows.length} dòng × ${HSNS.length} HSN = ${cells} ô so sánh`
    + `${diff ? ` — LỆCH ${diff}` : ' — không lệch ô nào'}`);
}

/* ---------- 4. buildHsnResolver: các ca rìa, hai bản phải trả giống nhau ---------- */
console.log('4) buildHsnResolver — các ca rìa');
const P = (id, hsn) => ({ id, hsn });
const points = [P('p1', 40), P('p2', 200), P('p0', 0)];
const A = (o) => ({ type: 'CONGTO', ...o });
const assets = [
  A({ serial: 'M1', point: 'p1', date_on: '2026-01-01', date_off: '2026-06-30' }),
  A({ serial: 'M1', point: 'p2', date_on: '2026-06-30' }),          // treo lại ĐÚNG ngày tháo
  A({ serial: 'M2', point: 'p1', date_off: '2026-05-05' }),          // thiếu ngày treo
  A({ serial: 'M3', point: 'p1', date_on: '2026-08-01' }),
  A({ serial: 'M4', point: '', date_on: '2026-01-01' }),             // không gắn điểm đo
  A({ serial: 'M5', point: 'p0', date_on: '2026-01-01' }),           // điểm đo HSN = 0
];
const cases = [
  ['M1', '2026-03-15 10:00:00', 'giữa lần treo đầu'],
  ['M1', '2026-06-30 10:00:00', 'ngày vừa tháo vừa treo lại → lấy lần MUỘN hơn'],
  ['M1', '2026-08-01 10:00:00', 'lần treo thứ hai, chưa tháo'],
  ['M2', '2026-03-01 10:00:00', 'thiếu ngày treo'],
  ['M3', '2026-07-31 10:00:00', 'trước ngày treo'],
  ['M4', '2026-03-01 10:00:00', 'không gắn điểm đo'],
  ['M5', '2026-03-01 10:00:00', 'điểm đo HSN = 0'],
  ['M9', '2026-03-01 10:00:00', 'không có trong danh mục'],
];
const rMjs = mjs.buildHsnResolver(assets, points);
const rTs = ts.buildHsnResolver(assets, points);
for (const [sn, dt, what] of cases) {
  const a = rMjs(sn, dt), b = rTs(sn, dt);
  const k = (r) => r.reason ?? `HSN ${r.hsn} @ ${r.point.id}`;
  if (k(a) !== k(b)) bad(`${sn} ${dt} (${what}): mjs=${k(a)} ts=${k(b)}`);
  else console.log(`  ✔ ${what.padEnd(46)} → ${k(a)}`);
}

console.log(fail ? `\n${fail} chỗ LỆCH.` : '\nHai bản khớp nhau hoàn toàn.');
process.exit(fail ? 1 : 0);
