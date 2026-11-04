#!/usr/bin/env node
/**
 * Vòng đời công tơ → `public/meter_lifecycle.csv`, một dòng mỗi công tơ của HES.
 *
 *   FIRST_DATA  ngày có chỉ số đầu tiên = NGÀY VÀO HOẠT ĐỘNG (user chốt 04/11/2026)
 *   LAST_DATA   ngày có chỉ số gần nhất — CHỈ để tham khảo
 *   CREATED     thời gian tạo công tơ trên HES
 *   FIRST_CAPPED=1  công tơ đã có số ngay từ ngày đầu của kho dữ liệu, nên ngày vào thật
 *                   có thể SỚM HƠN FIRST_DATA
 *
 * KHÔNG có ngày tháo, và cố ý không suy ra: công tơ có thể tái sử dụng ở điểm đo khác với
 * HSN khác, nên ngày tháo/treo các lần sau do người dùng nhập ở `dm_asset` (user chốt
 * 04/11/2026). Script không đọc hay ghi PocketBase.
 *
 * FIRST_DATA đã ghi thì chỉ có thể lùi về sớm hơn: `ChiSo_30min` chỉ giữ 30 ngày, tính lại
 * từ file còn lại sẽ làm ngày vào trượt dần theo.
 *
 *   node scripts/meter_lifecycle.mjs                     # pipeline: public/ChiSo_30min
 *   node scripts/meter_lifecycle.mjs --archive <thư mục> # dựng ban đầu từ kho lưu trữ
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = process.env.METER_LIFECYCLE_PATH || 'public/meter_lifecycle.csv';
const INFO = process.env.METTERINFO_PATH || 'public/metterinfo.csv';
const DIR = process.env.CHISO_30MIN_DIR || 'public/ChiSo_30min';
const FIELDS = ['METER_NO', 'CREATED', 'FIRST_DATA', 'LAST_DATA', 'FIRST_CAPPED'];

/** CSV không có ô chứa dấu phẩy. `metterinfo` có (tên khách) nên đọc riêng ở `createdOf`. */
function readPlain(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',');
  return lines.slice(1).map(l => {
    const c = l.split(',');
    return Object.fromEntries(head.map((h, i) => [h.trim(), (c[i] ?? '').trim()]));
  });
}

/** Công tơ của `metterinfo` → CREATED. Cột cuối nên đọc từ cuối dòng, tránh tên có dấu phẩy. */
function createdOf(path) {
  const out = new Map();
  if (!existsSync(path)) return out;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const hasCreated = (lines[0] ?? '').trim().endsWith(',CREATED');
  for (const l of lines.slice(1)) {
    const no = l.slice(0, l.indexOf(',')).trim();
    if (no) out.set(no, hasCreated ? l.slice(l.lastIndexOf(',') + 1).trim() : '');
  }
  return out;
}

/** Công tơ → [ngày đầu, ngày cuối] có số trong một thư mục ChiSo (đọc từng file ngày). */
export function scanDir(dir, span = new Map()) {
  if (!existsSync(dir)) return { span, days: [] };
  const days = readdirSync(dir).map(f => /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(f)?.[1]).filter(Boolean).sort();
  for (const day of days) {
    const lines = readFileSync(join(dir, `${day}.csv`), 'utf8').split(/\r?\n/);
    const seen = new Set();
    for (const l of lines.slice(1)) {
      const no = l.slice(0, l.indexOf(',')).trim();
      if (!no || seen.has(no)) continue;
      seen.add(no);
      const cur = span.get(no);
      if (!cur) span.set(no, [day, day]);
      else { if (day < cur[0]) cur[0] = day; if (day > cur[1]) cur[1] = day; }
    }
  }
  return { span, days };
}

function main() {
  const i = process.argv.indexOf('--archive');
  const archive = i >= 0 ? process.argv[i + 1] : '';
  const span = new Map();
  let firstArchiveDay = '';
  if (archive) {
    const { days } = scanDir(archive, span);
    if (!days.length) throw new Error(`Không có file ngày nào trong ${archive}`);
    firstArchiveDay = days[0];
  }
  scanDir(DIR, span);

  const old = new Map(readPlain(OUT).map(r => [r.METER_NO, r]));
  const created = createdOf(INFO);
  const serials = [...new Set([...created.keys(), ...span.keys(), ...old.keys()])].sort();
  const rows = serials.map(no => {
    const o = old.get(no), s = span.get(no);
    const first = [o?.FIRST_DATA, s?.[0]].filter(Boolean).sort()[0] ?? '';
    const last = [o?.LAST_DATA, s?.[1]].filter(Boolean).sort().at(-1) ?? '';
    return {
      METER_NO: no,
      CREATED: created.get(no) || o?.CREATED || '',
      FIRST_DATA: first,
      LAST_DATA: last,
      FIRST_CAPPED: o?.FIRST_CAPPED === '1' || (firstArchiveDay && first === firstArchiveDay) ? '1' : '',
    };
  });
  writeFileSync(OUT, [FIELDS.join(','), ...rows.map(r => FIELDS.map(f => r[f]).join(','))].join('\n') + '\n', 'utf8');
  const withData = rows.filter(r => r.FIRST_DATA).length;
  console.log(`meter_lifecycle.csv: ${rows.length} công tơ, ${withData} từng có số, `
    + `${rows.filter(r => r.FIRST_CAPPED).length} có ngày vào thật có thể sớm hơn FIRST_DATA.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
