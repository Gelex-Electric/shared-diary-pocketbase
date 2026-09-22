#!/usr/bin/env node
/**
 * Tính lại số liệu LỊCH SỬ của một công tơ bị nhân sai hệ số nhân.
 *
 * Vì sao cần (22/09/2026): `fetch_meter_data.py` nhân HSN lấy từ `METER_NAME`
 * của HES, trong khi nguồn đúng là `dm_point.hsn` bên Danh mục. Đối chiếu ngày
 * 22/09 ra công tơ **2510203134**: HES ghi 320, Danh mục ghi 200 — mọi giá trị
 * công suất và dòng điện của nó trong `datametter.csv` và `pmax_daily.csv` đều
 * VỐNG 60% kể từ 01/01/2026.
 *
 * Nguồn HSN đã sửa ở `fetch_meter_data.py`, nhưng số cũ nằm sẵn trong file —
 * `pmax_daily.csv` lưu vĩnh viễn nên nó sẽ sai mãi nếu không sửa tay.
 *
 * VÌ SAO NHÂN LẠI ĐƯỢC MỘT HỆ SỐ CỐ ĐỊNH: đã kiểm trước khi làm — công tơ
 * 2510203134 cùng cả 3 TI ở điểm đo đều treo từ 27/04/2025 và chưa tháo, nên
 * HSN đúng là 200 SUỐT giai đoạn có dữ liệu. Nếu HSN từng đổi giữa chừng thì
 * nhân đều một hệ số là sai, phải chia giai đoạn.
 *
 * Chỉ sửa ĐÚNG các cột được nhân HSN (`SCALED_FIELDS` bên Python): công suất và
 * dòng điện. ĐIỆN ÁP giữ nguyên — nó không nhân HSN bao giờ.
 *
 *   node scripts/fix_hsn_history.mjs --meter 2510203134 --from 320 --to 200 --dry-run
 *   node scripts/fix_hsn_history.mjs --meter 2510203134 --from 320 --to 200
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const arg = (name, def = '') => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes('--dry-run');
const METER = arg('--meter');
const FROM = Number(arg('--from'));
const TO = Number(arg('--to'));

if (!METER || !Number.isFinite(FROM) || !Number.isFinite(TO) || !FROM) {
  console.error('Cần --meter <số công tơ> --from <HSN cũ> --to <HSN đúng>');
  process.exit(1);
}
const K = TO / FROM;

/** Cột nào bị nhân HSN ở file nào — phải khớp `SCALED_FIELDS` bên Python. */
const TARGETS = [
  {
    path: 'public/datametter.csv',
    cols: ['TOTAL_KW', 'PHASE_A_AMPERE', 'PHASE_B_AMPERE', 'PHASE_C_AMPERE', 'TOTAL_KVAR'],
  },
  { path: 'public/pmax_daily.csv', cols: ['PMAX_KW'] },
];

console.log(`Công tơ ${METER}: HSN ${FROM} → ${TO}  (nhân lại ×${K})${DRY ? '   [DRY-RUN]' : ''}\n`);

for (const { path, cols } of TARGETS) {
  if (!existsSync(path)) { console.log(`[bỏ qua] ${path}: không có file.`); continue; }

  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.trimEnd().split(/\r?\n/);
  const head = lines[0].split(',');
  const iMeter = head.indexOf('METER_NO');
  const idx = cols.map(c => head.indexOf(c)).filter(i => i >= 0);

  if (iMeter < 0 || idx.length === 0) {
    console.log(`[bỏ qua] ${path}: không thấy cột cần sửa.`);
    continue;
  }

  let hit = 0;
  const sample = [];
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells[iMeter] !== METER) { out.push(lines[i]); continue; }
    hit++;
    for (const j of idx) {
      const v = Number(cells[j]);
      if (!Number.isFinite(v)) continue;
      const nv = v * K;
      if (sample.length < 3 && j === idx[0]) sample.push(`${cells[1]}: ${v} → ${round(nv)}`);
      /* Giữ đúng cách Python ghi số (`%g`): bỏ số 0 thừa, không ép thập phân. */
      cells[j] = String(round(nv));
    }
    out.push(cells.join(','));
  }

  console.log(`${path}: ${hit} dòng của công tơ này`
    + `${hit ? ` · ${cols.filter((_, k) => idx[k] >= 0).join(', ')}` : ''}`);
  for (const s of sample) console.log(`    ${s}`);

  if (!hit || DRY) continue;
  writeFileSync(path, out.join(eol) + eol, 'utf8');
  console.log('  ✔ đã ghi');
}

/** Làm tròn như `%g` của Python: tối đa 6 chữ số có nghĩa, bỏ đuôi 0. */
function round(n) {
  return Number(n.toPrecision(6));
}

if (DRY) console.log('\n[DRY-RUN] Chưa ghi gì. Bỏ --dry-run để ghi thật.');
