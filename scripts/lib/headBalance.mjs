/**
 * ĐỐI SOÁT ĐẦU NGUỒN — một điểm đo đầu nguồn ↔ tổng các điểm đo chính cùng lộ,
 * trong MỘT ngày (plan 2026-09-24-diem-do-dau-nguon.md, T7).
 *
 * Hàm THUẦN: nhận chuỗi 30' đã dựng sẵn (`buildDaySeries` của hes30.mjs) — không
 * đọc file, không gọi mạng — để test độc lập.
 *
 *   E_HEAD   sản lượng đầu nguồn (ΔPG × HSN, cộng theo phần chồng lấn với ngày)
 *   E_SUM    Σ sản lượng các điểm đo chính của lộ có số trong ngày
 *   LOSS     E_HEAD − E_SUM — tổn thất lưới trung thế + MBA (điểm đo khách ở hạ thế)
 *   PMAX_HEAD  đỉnh P trung bình 30' của đầu nguồn (cùng cách Pmax lộ, từ chỉ số)
 *
 * "Đủ số" của một điểm đo = có ÍT NHẤT bằng số mốc của đầu nguồn trong ngày đó (không
 * so với 48 cố định: thiếu file hôm sau thì MỌI công tơ cùng hụt mốc 23:30 — so với 48
 * sẽ ra "0/11 đủ số" dù thực tế đủ). Ngày thiếu số thì LOSS phồng lên vì thiếu chứ
 * không phải vì tổn thất — `COVERED < TOTAL` là để người đọc (và cảnh báo) biết.
 *
 * Đầu nguồn có dưới NỬA ngày số liệu (vd ngày công tơ bắt đầu có số) ⇒ không sinh dòng:
 * so một phần ngày với cả ngày của các điểm đo là số rác (đo được −58 %, −100 %).
 */
export const SLOTS_FULL = 48;
/** Đầu nguồn phải có ít nhất ngần này mốc thì mới đối soát ngày đó. */
export const MIN_HEAD_SLOTS = SLOTS_FULL / 2;

const r1 = (x) => Math.round(x * 10) / 10;
const hhmm = (slot) => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;

/**
 * @param series   kết quả `buildDaySeries(day)`
 * @param head     { code, lineCode, serials: string[] } — công tơ của điểm đầu nguồn
 * @param members  [{ serial }] — công tơ các điểm đo chính của lộ (`metersByLine`)
 * @param lineRow  dòng `pmax_line_daily.csv` của lộ + ngày (hoặc undefined)
 * @returns dòng CSV, hoặc null nếu đầu nguồn không có số ngày đó
 */
export function balanceOfDay(series, head, members, lineRow) {
  const hm = head.serials.map(s => series.meters.get(s)).filter(Boolean);
  if (!hm.length) return null;
  const eHead = hm.reduce((t, m) => t + m.energyKwh, 0);
  const headSlots = Math.max(...hm.map(m => m.covered));
  if (headSlots < MIN_HEAD_SLOTS) return null;

  /* Đỉnh đầu nguồn: cộng các công tơ đầu nguồn theo mốc (thường chỉ một cái). */
  const bySlot = new Map();
  for (const m of hm) for (const [slot, v] of m.slots) bySlot.set(slot, (bySlot.get(slot) ?? 0) + v.p);
  let pmax = -Infinity, at = null;
  for (const [slot, p] of bySlot) if (p > pmax) { pmax = p; at = slot; }

  let eSum = 0, covered = 0, withData = 0;
  const need = Math.min(SLOTS_FULL, headSlots);
  /* Công tơ thiếu mốc — cho thẻ "thiếu dữ liệu" nêu đúng tên (không ghi vào CSV). */
  const missing = [];
  for (const { serial } of members) {
    const m = series.meters.get(serial);
    if (!m) { missing.push({ serial, slots: 0 }); continue; }
    withData++;
    eSum += m.energyKwh;
    if (m.covered >= need) covered++; else missing.push({ serial, slots: m.covered });
  }

  const loss = eHead - eSum;
  const pLine = lineRow ? Number(lineRow.PMAX_KW) : NaN;
  return {
    HEAD_CODE: head.code,
    LINE_CODE: head.lineCode,
    /* KCN của điểm đầu nguồn — app lọc theo KCN như mọi tab (thêm 25/09/2026). */
    ZONE: head.zone ?? '',
    DATE: series.day,
    E_HEAD_KWH: r1(eHead),
    E_SUM_KWH: r1(eSum),
    LOSS_KWH: r1(loss),
    LOSS_PCT: eHead > 0 ? Math.round((loss / eHead) * 10000) / 100 : '',
    PMAX_HEAD_KW: Number.isFinite(pmax) ? r1(pmax) : '',
    AT_HEAD: at === null ? '' : hhmm(at),
    PMAX_LINE_KW: Number.isFinite(pLine) ? r1(pLine) : '',
    AT_LINE: lineRow?.AT ?? '',
    PMAX_RATIO: Number.isFinite(pLine) && pmax > 0 ? Math.round((pLine / pmax) * 1000) / 10 : '',
    COVERED: covered,
    WITH_DATA: withData,
    TOTAL: members.length,
    HEAD_SLOTS: headSlots,
    /* Không phải cột CSV — BALANCE_FIELDS không có nó nên không bị ghi ra. */
    missing,
    need,
  };
}

export const BALANCE_FIELDS = [
  'HEAD_CODE', 'LINE_CODE', 'DATE', 'E_HEAD_KWH', 'E_SUM_KWH', 'LOSS_KWH', 'LOSS_PCT',
  'PMAX_HEAD_KW', 'AT_HEAD', 'PMAX_LINE_KW', 'AT_LINE', 'PMAX_RATIO',
  'COVERED', 'WITH_DATA', 'TOTAL', 'HEAD_SLOTS', 'ZONE',
];

/* ------------------------------ cảnh báo ------------------------------ */
/**
 * Ngưỡng user chốt 24/09/2026 sau khi xem số thật 31/08–23/09 (tổn thất 2,1–2,5 %
 * ngày thường, 3,5–4,3 % ngày lễ; Pmax lộ/đầu nguồn 96,4–100,7 %).
 */
export const LOSS_DEV_PP = Number(process.env.HEAD_LOSS_DEV_PP || 1.5);
export const LOSS_WINDOW = 7;
export const PMAX_RATIO_MIN = 90;
export const PMAX_RATIO_MAX = 105;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
/** Ngày "đủ số" để làm chuẩn so sánh: đầu nguồn ≥ 47 mốc (47 = thiếu file hôm sau) và đủ điểm đo. */
export const isFullRow = (r) => parseInt(r.HEAD_SLOTS, 10) >= SLOTS_FULL - 1 && Number(r.COVERED) === Number(r.TOTAL);

/**
 * Các cảnh báo của MỘT dòng đối soát.
 *
 * @param row      dòng vừa tính (có `missing`)
 * @param history  các dòng CŨ HƠN của cùng điểm đầu nguồn (từ CSV), thứ tự bất kỳ
 * @returns [{ type: 'thieu'|'lech'|'pmax', ... }]
 *
 * Thiếu số ⇒ CHỈ báo thiếu, không xét lệch (tổn thất phồng vì thiếu, không phải sự cố).
 * Lệch: cần đủ LOSS_WINDOW ngày đủ số liền trước; chưa đủ thì im lặng.
 */
export function alertsOfRow(row, history) {
  if (parseInt(row.HEAD_SLOTS, 10) < SLOTS_FULL - 1) return [];     // đầu nguồn chưa đủ mốc
  if (Number(row.COVERED) < Number(row.TOTAL)) return [{ type: 'thieu', missing: row.missing ?? [] }];
  const out = [];
  const prev = history.filter(r => r.DATE < row.DATE && isFullRow(r) && r.LOSS_PCT !== '')
    .sort((a, b) => b.DATE.localeCompare(a.DATE)).slice(0, LOSS_WINDOW);
  if (prev.length === LOSS_WINDOW && row.LOSS_PCT !== '') {
    const med = median(prev.map(r => Number(r.LOSS_PCT)));
    const dev = Number(row.LOSS_PCT) - med;
    if (Math.abs(dev) > LOSS_DEV_PP) out.push({ type: 'lech', median: Math.round(med * 100) / 100, dev: Math.round(dev * 100) / 100 });
  }
  const ratio = row.PMAX_RATIO === '' ? NaN : Number(row.PMAX_RATIO);
  if (Number.isFinite(ratio) && (ratio < PMAX_RATIO_MIN || ratio > PMAX_RATIO_MAX)) out.push({ type: 'pmax', ratio });
  return out;
}
