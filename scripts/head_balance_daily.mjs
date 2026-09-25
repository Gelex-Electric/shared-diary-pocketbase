#!/usr/bin/env node
/**
 * Đối soát ĐẦU NGUỒN theo ngày → `public/head_balance_daily.csv` (lưu VĨNH VIỄN —
 * ChiSo_30min chỉ giữ 30 ngày). Plan 2026-09-24-diem-do-dau-nguon.md, T7.
 *
 * Mỗi điểm đo `role = dau_nguon` (có `line`) × mỗi ngày: sản lượng đầu nguồn so với
 * tổng các điểm đo chính cùng lộ (tổn thất lưới), Pmax đầu nguồn so với Pmax lộ, và
 * độ phủ số liệu. Công thức ở `lib/headBalance.mjs`.
 *
 * Chạy:
 *   node scripts/head_balance_daily.mjs                  # hôm kia + hôm qua (hoặc TARGET_DATE)
 *   node scripts/head_balance_daily.mjs --date 2026-09-18
 *   node scripts/head_balance_daily.mjs --all            # mọi ngày đang có trong ChiSo_30min
 *   ... --out <file>   ghi chỗ khác (mặc định public/head_balance_daily.csv)
 *   ... --notify       ghi cảnh báo kind `daunguon` (lệch tổn thất / Pmax / thiếu dữ liệu)
 *
 * Vì sao mặc định tính lại cả HÔM KIA: khoảng 23:30 → 00:00 cần mốc đầu của file hôm
 * sau; lúc chạy cho "hôm qua" thì file hôm nay chưa có ⇒ hôm qua hụt một mốc. Đêm
 * sau tính lại là đủ (cùng lý do với loss_daily.mjs).
 *
 * Cần: PB_EMAIL/PB_PASS (chỉ ĐỌC danh mục).
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { pbLogin, allOf } from './lib/pb_meters.mjs';
import { buildDaySeries, addDays } from './lib/hes30.mjs';
import { metersByLine } from './lib/lineMembers.mjs';
import { balanceOfDay, alertsOfRow, BALANCE_FIELDS, LOSS_DEV_PP, LOSS_WINDOW, PMAX_RATIO_MIN, PMAX_RATIO_MAX } from './lib/headBalance.mjs';
import { raiseAlert } from './lib/pb_alert.mjs';
import { readCsv } from './fetch_hes_index.mjs';

const DIR_30 = process.env.CHISO_30MIN_DIR || process.env.HES_30MIN_DIR || 'public/ChiSo_30min';
const LINE_CSV = process.env.PMAX_LINE_OUT || 'public/pmax_line_daily.csv';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const OUT = arg('--out') || 'public/head_balance_daily.csv';

function todayVn() {
  const now = new Date();
  const vn = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
  const p = (n) => String(n).padStart(2, '0');
  return `${vn.getFullYear()}-${p(vn.getMonth() + 1)}-${p(vn.getDate())}`;
}

const have = existsSync(DIR_30)
  ? readdirSync(DIR_30).map(f => /^(\d{4}-\d{2}-\d{2})\.csv$/.exec(f)?.[1]).filter(Boolean).sort() : [];
const days = (() => {
  if (arg('--date')) return [arg('--date')];
  if (process.argv.includes('--all')) return have;
  const t = (process.env.TARGET_DATE || '').trim() || addDays(todayVn(), -1);
  return [addDays(t, -1), t].filter(d => have.includes(d));
})();
if (!days.length) { console.error(`Không có ngày nào để tính trong ${DIR_30}.`); process.exit(1); }

const token = await pbLogin();
const [points, assets, stations, lines, customers, zones] = await Promise.all(
  ['dm_point', 'dm_asset', 'dm_station', 'dm_line', 'dm_customer', 'dm_zone'].map(c => allOf(c, token)));
const byLine = metersByLine({ stations, points, assets, customers });

const heads = points.filter(p => p.role === 'dau_nguon').map(p => {
  const line = lines.find(l => l.id === p.line);
  return {
    code: p.code || p.line_name || p.id,
    zone: zones.find(z => z.id === (p.zone || line?.zone))?.name ?? '',
    lineId: p.line,
    lineCode: line?.code ?? '',
    /* MỌI công tơ từng gắn ở điểm đầu nguồn: ngày cũ có thể là công tơ trước đó. */
    serials: assets.filter(a => a.type === 'CONGTO' && a.point === p.id).map(a => String(a.serial).trim()),
  };
});
const bad = heads.filter(h => !h.lineId || !h.lineCode);
if (bad.length) console.log(`[CẢNH BÁO] điểm đầu nguồn thiếu lộ — bỏ qua: ${bad.map(h => h.code).join(', ')}`);
const ok = heads.filter(h => h.lineCode && h.serials.length);
if (!ok.length) { console.error('Không có điểm đo đầu nguồn nào (role dau_nguon, có lộ, có công tơ).'); process.exit(1); }

const lineRows = new Map(readCsv(LINE_CSV).map(r => [`${r.LINE_CODE}|${r.DATE}`, r]));
const out = [];
for (const day of days) {
  const series = buildDaySeries(day, { dir: DIR_30 });
  for (const h of ok) {
    const members = byLine.get(h.lineId) ?? [];
    const row = balanceOfDay(series, h, members, lineRows.get(`${h.lineCode}|${day}`));
    if (!row) { console.log(`${day} ${h.code}: đầu nguồn không có số — bỏ.`); continue; }
    if (series.nextDayMissing) row.HEAD_SLOTS = `${row.HEAD_SLOTS}*`;
    out.push(row);
  }
}

/* In bảng gọn để soát bằng mắt. */
console.log('\nNGÀY        ĐẦU NGUỒN kWh   TỔNG ĐĐ kWh   TỔN THẤT       Pmax ĐN  Pmax lộ  tỷ lệ  phủ');
for (const r of out) {
  console.log(`${r.DATE}  ${String(r.E_HEAD_KWH).padStart(12)}  ${String(r.E_SUM_KWH).padStart(12)}  `
    + `${String(r.LOSS_KWH).padStart(9)} ${String(r.LOSS_PCT).padStart(6)}%  ${String(r.PMAX_HEAD_KW).padStart(7)} `
    + `${String(r.PMAX_LINE_KW).padStart(8)} ${String(r.PMAX_RATIO).padStart(5)}%  ${r.COVERED}/${r.WITH_DATA}/${r.TOTAL}`
    + `${String(r.HEAD_SLOTS).endsWith('*') ? '  (thiếu file hôm sau — hụt mốc 23:30)' : ''}`);
}

/* Gộp với file cũ theo (HEAD_CODE, DATE): chạy lại không nhân đôi, ngày cũ giữ nguyên. */
const merged = new Map(readCsv(OUT).map(r => [`${r.HEAD_CODE}|${r.DATE}`, r]));
for (const r of out) merged.set(`${r.HEAD_CODE}|${r.DATE}`, r);
const all = [...merged.values()].sort((a, b) => (a.DATE + a.HEAD_CODE).localeCompare(b.DATE + b.HEAD_CODE));
writeFileSync(OUT, [BALANCE_FIELDS.join(','), ...all.map(r => BALANCE_FIELDS.map(f => r[f] ?? '').join(','))].join('\n') + '\n', 'utf8');
console.log(`\n✔ ${OUT}: ${all.length} dòng (${out.length} vừa tính).`);

/* ------------------------------- cảnh báo ------------------------------- */
/*
  Mỗi ngày tối đa 3 thẻ / điểm đầu nguồn (kind `daunguon`, hiện trong mục "Chỉ số
  bất thường"). `message` KHÔNG chứa con số — đêm sau tính lại (đủ mốc 23:30) số
  nhích một chút, có số trong message là đẻ ra thẻ thứ hai. Số nằm ở `details`.
*/
if (process.argv.includes('--notify')) {
  const pointOf = (serial) => {
    const a = assets.find(x => x.type === 'CONGTO' && String(x.serial).trim() === serial && x.point);
    return points.find(p => p.id === a?.point);
  };
  const fmt = (x) => Number(x).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  for (const row of out) {
    const h = ok.find(x => x.code === row.HEAD_CODE);
    const history = all.filter(r => r.HEAD_CODE === row.HEAD_CODE);
    for (const a of alertsOfRow(row, history)) {
      const base = { meter: h.serials[h.serials.length - 1] ?? '', customer: '', station: h.code, zone: h.zone, day: row.DATE };
      let alert;
      if (a.type === 'thieu') {
        alert = {
          title: 'Đối soát đầu nguồn: thiếu dữ liệu điểm đo',
          message: `Ngày ${row.DATE}: ${h.code} (lộ ${h.lineCode}) — ${a.missing.length} điểm đo chính thiếu mốc, chưa đối soát được`,
          meters: a.missing.map(m => m.serial),
          details: a.missing.map(m => ({ meter: m.serial, customer: '', station: pointOf(m.serial)?.code ?? '',
            zone: h.zone, day: row.DATE, note: `${m.slots}/${row.need} mốc` })),
        };
      } else if (a.type === 'lech') {
        alert = {
          title: 'Đối soát đầu nguồn: tổn thất lưới lệch bất thường',
          message: `Ngày ${row.DATE}: ${h.code} (lộ ${h.lineCode}) — tổn thất lệch quá ${LOSS_DEV_PP} điểm % so với trung vị ${LOSS_WINDOW} ngày`,
          meters: [base.meter],
          details: [{ ...base, value: Number(row.LOSS_KWH), unit: 'kWh',
            note: `tổn thất ${fmt(row.LOSS_PCT)} % (đầu nguồn ${fmt(row.E_HEAD_KWH)} − tổng điểm đo ${fmt(row.E_SUM_KWH)} kWh)`
              + ` · trung vị ${LOSS_WINDOW} ngày ${fmt(a.median)} % · lệch ${a.dev > 0 ? '+' : ''}${fmt(a.dev)} điểm %` }],
        };
      } else {
        alert = {
          title: 'Đối soát đầu nguồn: Pmax lộ lệch Pmax đầu nguồn',
          message: `Ngày ${row.DATE}: ${h.code} (lộ ${h.lineCode}) — Pmax lộ / Pmax đầu nguồn ngoài [${PMAX_RATIO_MIN} %, ${PMAX_RATIO_MAX} %]`,
          meters: [base.meter],
          details: [{ ...base, value: Number(row.PMAX_HEAD_KW), unit: 'kW',
            note: `Pmax lộ ${fmt(row.PMAX_LINE_KW)} kW lúc ${row.AT_LINE} / đầu nguồn ${fmt(row.PMAX_HEAD_KW)} kW lúc ${row.AT_HEAD} = ${fmt(a.ratio)} %` }],
        };
      }
      const okw = await raiseAlert(token, { kind: 'daunguon', zone: h.zone, day: row.DATE, ...alert });
      console.log(`Cảnh báo [${a.type}] ${row.DATE} ${h.code}: ${okw ? 'ĐÃ GHI' : 'bỏ qua (đã có)'}`);
    }
  }
}
