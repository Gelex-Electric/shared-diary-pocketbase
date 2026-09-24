#!/usr/bin/env node
/**
 * Tổn thất kỹ thuật máy biến áp theo TRẠM — lõi mới, nguồn PocketBase + hiệu chỉ số 30′.
 * Thay `scripts/daily_transformer_loss.py` (giữ lại file cũ làm mốc đối chiếu).
 *
 * NGUỒN (user chốt 23/09/2026):
 *   · Trạm, thông số nhãn, vai trò điểm đo, công tơ đang treo → **PocketBase Danh mục**
 *     (`dm_station` / `dm_point` / `dm_asset`), qua `lib/pb_meters.mjs`.
 *   · Công suất P, Q và sản lượng → **`public/hes_30min/`** qua `lib/hes30.mjs`
 *     (P = ΔPG × HSN ÷ Δt thực). KHÔNG dùng mẫu tức thời của `datametter.csv` nữa.
 *   · P0/Pk → `lib/lossParams.mjs` (hiểu 2 cờ `auto_loss_param` / `mv_metering`).
 *
 * CÔNG THỨC giữ NGUYÊN của bản Python (đã kiểm chứng, không đụng):
 *   S = √(P² + Q²) ;  tải = S/Sdm ;  ΔP = P0 + Pk×tải²
 *   LOSS = Σ ΔP×Δt ;  LOSS_PCT = LOSS / (OUTPUT + LOSS)
 *
 * BA ĐIỀU ĐÃ TRẢ GIÁ Ở CÁC BƯỚC TRƯỚC, mang theo:
 *
 *   1. **Tính lại NGÀY HÔM KIA mỗi lần chạy.** Khoảng 23:30→00:00 có bản đọc cuối nằm
 *      ở file ngày SAU; lúc pipeline tính cho "hôm qua" thì file hôm nay chưa ghi ⇒ hụt
 *      mốc 23:30 ≈ 2% sản lượng lẫn tổn thất MỖI NGÀY. Khử trùng theo (CODE, DATE) nên
 *      ghi đè an toàn. Xem `logs/2026-09-23-t1-doc-chi-so-30-phut.md`.
 *
 *   2. **Trạm không đủ điều kiện thì BỎ DÒNG + IN DANH SÁCH** (user chốt 23/09). Không
 *      xuất dòng LOSS=0 — số 0 sẽ bị đọc là "trạm không tổn thất". Im lặng bỏ qua chính
 *      là cái bẫy của bản Python: thiếu file chỉ số thì nó chỉ in [WARN] rồi rơi về P×Δt
 *      cho TẤT CẢ trạm mà pipeline vẫn xanh.
 *
 *   3. **Cột `PARAM_SRC`** đánh dấu P0/Pk là số nhãn hay số ước lượng. Nối vào CUỐI file
 *      ngày nên reader cũ (đọc theo TÊN cột) không phải sửa.
 *
 * MẤT ĐIỆN (user chốt 23/09): mốc nào không khoảng chỉ số nào phủ qua thì KHÔNG tính,
 * kể cả P0. Không bịa số. Có `datametter.csv` thì đối chiếu thêm với điện áp = 0 và in
 * cảnh báo khi hai luật không khớp — giả định này chưa được kiểm chứng trên dữ liệu thật.
 *
 *   railway.exe run --service shared-diary-pocketbase --environment staging -- \
 *     node scripts/loss_daily.mjs --date 2026-09-14 --out-dir /tmp/thu   # KHÔNG ghi public/
 *   ... node scripts/loss_daily.mjs --from 2026-09-01 --to 2026-09-23    # ghi public/
 */
import fs from 'node:fs';
import path from 'node:path';
import { pbLogin, liveMeters } from './lib/pb_meters.mjs';
import { buildDaySeries, addDays, slotLabel, SLOTS_PER_DAY } from './lib/hes30.mjs';
import { resolveLossParams, SKIP_TRUNG_THE } from './lib/lossParams.mjs';

/* ------------------------------- tham số ------------------------------- */
const arg = (n, d = '') => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? (process.argv[i + 1] ?? d) : d;
};
const OUT_DIR = arg('--out-dir', 'public');
const SLOT_H = 0.5;                                   // mỗi mốc nửa giờ
const KEEP_DAYS_30 = Number(process.env.KEEP_DAYS_30 || 40);
const DM_PATH = process.env.DATAMETTER_PATH || 'public/datametter.csv';

const F30 = path.join(OUT_DIR, 'transformer_loss_30min.csv');
const FDAY = path.join(OUT_DIR, 'transformer_loss_daily.csv');

const FIELDS_30 = ['CODE', 'LINE_NAME', 'DATE_TIME', 'DUR_H', 'N_METERS', 'P_KW', 'Q_KVAR',
  'S_KVA', 'LOAD_PCT', 'DELTA_P_KW', 'OUTPUT_KWH', 'LOSS_NOLOAD_KWH', 'LOSS_LOAD_KWH', 'LOSS_KWH'];
/* `PARAM_SRC` nối vào CUỐI — reader cũ đọc theo tên cột nên không phải sửa. */
const FIELDS_DAY = ['CODE', 'LINE_NAME', 'DATE', 'OUTPUT_KWH', 'LOSS_NOLOAD_KWH', 'LOSS_LOAD_KWH',
  'LOSS_KWH', 'LOSS_PCT', 'MAX_LOAD_PCT', 'AVG_LOAD_PCT', 'N_INTERVALS', 'OUTPUT_SRC', 'PARAM_SRC'];

/** Ngày cần tính. Mặc định: HÔM QUA và HÔM KIA (xem điều 1 ở đầu file). */
function targetDays() {
  const one = arg('--date', '');
  if (one) return [one];
  const from = arg('--from', ''), to = arg('--to', '');
  if (from && to) {
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }
  const vnToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return [addDays(vnToday, -2), addDays(vnToday, -1)];
}

const num = (x, d = 6) => {
  if (!Number.isFinite(x)) return '';
  const r = Number(x.toFixed(d));
  return String(r);
};

/* --------------------------- đọc Danh mục PB --------------------------- */
const token = await pbLogin();
const { meters, points, stations } = await liveMeters(token);

const pointById = new Map(points.map(p => [p.id, p]));
/* Điểm đo CHÍNH đang vận hành, kèm công tơ đang treo. */
const metersOfStation = new Map();          // stationId → [{serial, hsn, pointCode}]
for (const m of meters) {
  const p = m.point;
  if (!p || p.role !== 'chinh' || p.status !== 'active' || !p.station) continue;
  if (!metersOfStation.has(p.station)) metersOfStation.set(p.station, []);
  metersOfStation.get(p.station).push({ serial: m.serial, hsn: m.hsn, pointCode: p.code || p.line_name || '' });
}

/* ------------------- đối chiếu mất điện bằng datametter ------------------- */
/**
 * serial → { seen: Set(slot có DÒNG), live: Set(slot có điện áp > 0) }.
 *
 * PHẢI tách hai tập. Bản đầu chỉ lưu `live` rồi coi "không có trong tập" là mất
 * điện — nhưng `datametter.csv` chỉ giữ ~7 ngày và RÌA cửa sổ thì thưa (ngày
 * 07/09 chỉ ~13 mốc/công tơ thay vì 48). Hệ quả: cảnh báo nổ 2.466 mốc "có chỉ
 * số mà điện áp = 0" trong khi thật ra chỉ là KHÔNG CÓ DÒNG NÀO để so.
 *
 * Trả `null` khi không so được — thà im lặng còn hơn báo động giả.
 */
function voltageSlots(day) {
  if (!fs.existsSync(DM_PATH)) return null;
  const out = new Map();
  const lines = fs.readFileSync(DM_PATH, 'utf8').split(/\r?\n/);
  const H = lines[0].split(',');
  const iA = H.indexOf('PHASE_A_VOLTS'), iB = H.indexOf('PHASE_B_VOLTS'), iC = H.indexOf('PHASE_C_VOLTS');
  if (iA < 0) return null;
  for (const l of lines.slice(1)) {
    if (!l) continue;
    const c = l.split(',');
    const stamp = c[1] || '';
    if (!stamp.startsWith(day)) continue;
    const slot = Math.min(SLOTS_PER_DAY - 1,
      Math.floor((Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16))) / 30));
    const k = c[0].trim();
    if (!out.has(k)) out.set(k, { seen: new Set(), live: new Set() });
    const e = out.get(k);
    e.seen.add(slot);
    if (Number(c[iA]) > 0 || Number(c[iB]) > 0 || Number(c[iC]) > 0) e.live.add(slot);
  }
  return out.size ? out : null;
}

/* ------------------------------ tính 1 ngày ------------------------------ */
function computeDay(day) {
  const series = buildDaySeries(day);
  const volt = voltageSlots(day);
  const rows30 = [], rowsDay = [];
  const skipped = new Map();      // lý do → [mô tả]
  const note = (reason, text) => {
    if (!skipped.has(reason)) skipped.set(reason, []);
    skipped.get(reason).push(text);
  };
  let mismatch = 0;

  for (const st of stations) {
    const label = st.code || '(chưa có mã)';
    const mine = metersOfStation.get(st.id) || [];

    /*
      THỨ TỰ XÉT quyết định log có dùng được hay không — phải xếp theo VIỆC CẦN LÀM:

        1. trung thế  → chủ ý bỏ, xét trước cả công tơ;
        2. công tơ    → chưa lắp thì khai thông số cũng chưa để làm gì;
        3. thông số   → có công tơ rồi mới đến lượt P0/Pk;
        4. chỉ số.

      Xét thông số trước công tơ (bản đầu của tôi) thì 44 trạm hiện ra ở nhóm
      "thiếu thông số" trong khi việc thật phải làm là lắp/khai công tơ.
    */
    const par = resolveLossParams(st, stations);
    if (!par.ok && par.reason === SKIP_TRUNG_THE) { note(par.reason, label); continue; }
    if (mine.length === 0) { note('KHONG_CO_CONG_TO', label); continue; }
    if (!par.ok) { note(par.reason, par.detail ? `${label} — ${par.detail}` : label); continue; }

    /* Gộp P, Q của các công tơ chính tại TỪNG mốc. */
    const slotAgg = new Map();       // slot → {p, q, n}
    let output = 0, haveIndex = false;
    for (const mt of mine) {
      const s = series.meters.get(mt.serial);
      if (!s) continue;
      haveIndex = true;
      output += s.energyKwh;
      for (const [slot, v] of s.slots) {
        const cur = slotAgg.get(slot) || { p: 0, q: 0, n: 0 };
        cur.p += v.p; cur.q += v.q; cur.n++;
        slotAgg.set(slot, cur);

        /* Chốt chặn: mốc CÓ chỉ số mà datametter ghi nhận điện áp = 0 thì giả
           định "không có số = mất điện" đang sai ở đâu đó. Chỉ so khi mốc đó
           THỰC SỰ có dòng trong datametter — vắng dòng không phải là mất điện. */
        const vs = volt?.get(mt.serial);
        if (vs?.seen.has(slot) && !vs.live.has(slot)) mismatch++;
      }
    }
    if (!haveIndex) { note('KHONG_CO_CHI_SO', `${label} — ${mine.length} công tơ, không có dòng nào trong hes_30min`); continue; }
    if (slotAgg.size === 0) { note('KHONG_CO_CHI_SO', `${label} — có công tơ nhưng không mốc nào tính được`); continue; }

    /* --- tích phân tổn thất trên các mốc CÓ ĐIỆN --- */
    let noload = 0, load = 0, loadPctSum = 0, maxLoadPct = 0;
    const slotsSorted = [...slotAgg.entries()].sort((a, b) => a[0] - b[0]);
    for (const [slot, v] of slotsSorted) {
      const s_kva = Math.sqrt(v.p * v.p + v.q * v.q);
      const tai = s_kva / par.sdmKva;
      const dNoload = par.p0W / 1000;                 // W → kW
      const dLoad = (par.pkW / 1000) * tai * tai;
      const dP = dNoload + dLoad;
      noload += dNoload * SLOT_H;
      load += dLoad * SLOT_H;
      const loadPct = tai * 100;
      loadPctSum += loadPct;
      if (loadPct > maxLoadPct) maxLoadPct = loadPct;

      rows30.push({
        CODE: label, LINE_NAME: label, DATE_TIME: `${day} ${slotLabel(slot)}:00`,
        DUR_H: SLOT_H, N_METERS: v.n,
        P_KW: num(v.p, 3), Q_KVAR: num(v.q, 3), S_KVA: num(s_kva, 4),
        LOAD_PCT: num(loadPct, 5), DELTA_P_KW: num(dP, 6),
        OUTPUT_KWH: num(v.p * SLOT_H, 3),
        LOSS_NOLOAD_KWH: num(dNoload * SLOT_H, 6),
        LOSS_LOAD_KWH: num(dLoad * SLOT_H, 6),
        LOSS_KWH: num(dP * SLOT_H, 6),
      });
    }

    const loss = noload + load;
    rowsDay.push({
      CODE: label, LINE_NAME: label, DATE: day,
      OUTPUT_KWH: num(output, 3),
      LOSS_NOLOAD_KWH: num(noload, 6), LOSS_LOAD_KWH: num(load, 6), LOSS_KWH: num(loss, 6),
      LOSS_PCT: num(output + loss > 0 ? (loss / (output + loss)) * 100 : 0, 5),
      MAX_LOAD_PCT: num(maxLoadPct, 5),
      AVG_LOAD_PCT: num(loadPctSum / slotsSorted.length, 5),
      N_INTERVALS: slotsSorted.length,
      /* Sản lượng nay LUÔN theo hiệu chỉ số — giữ từ vựng `index` của file cũ. */
      OUTPUT_SRC: 'index',
      PARAM_SRC: par.src,
    });
  }

  return { rows30, rowsDay, skipped, series, mismatch };
}

/* ------------------------------ ghi file ------------------------------ */
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const H = lines[0].split(',');
  return lines.slice(1).map(l => {
    const c = l.split(',');
    return Object.fromEntries(H.map((h, i) => [h, c[i] ?? '']));
  });
}

function writeCsv(file, fields, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = rows.map(r => fields.map(f => r[f] ?? '').join(',')).join('\n');
  fs.writeFileSync(file, `${fields.join(',')}\n${body}\n`, 'utf8');
}

/** Ghi đè theo khoá — chạy lại một ngày là thay đúng ngày đó, không nhân bản. */
function merge(file, fields, keyOf, fresh, prune) {
  const old = readCsv(file);
  const map = new Map(old.map(r => [keyOf(r), r]));
  for (const r of fresh) map.set(keyOf(r), r);
  let rows = [...map.values()];
  if (prune) rows = rows.filter(prune);
  rows.sort((a, b) => (a.CODE + (a.DATE || a.DATE_TIME)).localeCompare(b.CODE + (b.DATE || b.DATE_TIME)));
  writeCsv(file, fields, rows);
  return rows.length;
}

/* -------------------------------- chạy -------------------------------- */
const days = targetDays();
console.log(`\nTỔN THẤT MBA — nguồn: PocketBase + hes_30min`);
console.log(`Ngày tính: ${days.join(', ')}`);
console.log(`Danh mục: ${stations.length} trạm · ${pointById.size} điểm đo · ${meters.length} công tơ đang treo`);
console.log(`Ghi vào : ${OUT_DIR}/\n`);

const all30 = [], allDay = [];
for (const day of days) {
  const r = computeDay(day);
  all30.push(...r.rows30); allDay.push(...r.rowsDay);

  const bo = [...r.skipped.entries()].reduce((a, [, v]) => a + v.length, 0);
  console.log(`── ${day}: tính được ${r.rowsDay.length}/${stations.length} trạm · bỏ ${bo}`);
  if (r.series.nextDayMissing) {
    console.log(`   ⚠️  thiếu file hes_30min ngày ${addDays(day, 1)} ⇒ hụt mốc 23:30. `
      + `Chạy lại ngày này sau khi có file đó.`);
  }
  if (r.series.prevDayMissing) console.log(`   ⚠️  thiếu file ngày ${addDays(day, -1)} ⇒ hụt mốc 00:00.`);
  if (r.mismatch) {
    console.log(`   ⚠️  ${r.mismatch} mốc CÓ chỉ số nhưng điện áp = 0 trong datametter — `
      + `giả định "không có số = mất điện" cần xem lại.`);
  }
  for (const [reason, list] of r.skipped) {
    const title = reason === SKIP_TRUNG_THE ? `${reason} (chủ ý bỏ, không phải thiếu dữ liệu)` : reason;
    console.log(`   ${title}: ${list.length}`);
    list.slice(0, 12).forEach(x => console.log(`      · ${x}`));
    if (list.length > 12) console.log(`      … và ${list.length - 12} trạm nữa`);
  }
}

const cutoff = addDays(new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10), -KEEP_DAYS_30);
const n30 = merge(F30, FIELDS_30, r => `${r.CODE}|${r.DATE_TIME}`, all30,
  r => String(r.DATE_TIME).slice(0, 10) >= cutoff);
const nDay = merge(FDAY, FIELDS_DAY, r => `${r.CODE}|${r.DATE}`, allDay, null);

console.log(`\n${F30}: ${n30} dòng (giữ ${KEEP_DAYS_30} ngày)`);
console.log(`${FDAY}: ${nDay} dòng (giữ toàn bộ)\n`);
