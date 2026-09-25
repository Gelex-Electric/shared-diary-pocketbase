/**
 * Thông số tức thời 30 phút (`public/ThongSo_30min/<ngày>.csv`) — lưu RAW, nhân HSN lúc ĐỌC.
 *
 * User chốt 24/09/2026: file giữ ĐÚNG số HES trả, KHÔNG nhân HSN, KHÔNG có cột HSN.
 * HSN là thuộc tính của ĐIỂM ĐO (TI/TU tại vị trí treo), không phải của công tơ:
 * công tơ tháo ở điểm này treo sang điểm khác thì HSN đổi theo điểm. Nên nơi đọc
 * tra: số công tơ → lần treo (`dm_asset`) chứa ngày của mốc → `point` → `dm_point.hsn`.
 *
 * Lợi ích: sửa HSN / ngày treo trong Danh mục là số lịch sử tự đúng theo, không phải
 * tải lại — khác `datametter.csv` đã nhân cứng HSN vào số.
 *
 * Module THUẦN (không gọi mạng) để test độc lập. Bản TS cho app: `src/lib/thongso.ts`.
 *
 * Điểm ĐẦU NGUỒN (vd 2246006313) nay khai trong Danh mục (`role = dau_nguon`, schema
 * v17) nên đi đúng đường tra như mọi công tơ — không còn file ngoại lệ (bỏ 24/09/2026).
 */

/**
 * Cột file → trường `GetInstantByDate`, kèm cờ có nhân HSN hay không.
 *
 * KHÔNG nhân: điện áp pha (TU hạ thế 1/1 ở mọi điểm đo hiện nay), hệ số công suất,
 * tần số. Luật trong CLAUDE.md ghi "mọi trường còn lại ×HSN" — áp nguyên văn thì
 * PF 0,99 × HSN 400 = 396, vô nghĩa. Luật đó viết cho các trường có trong
 * `datametter` (U, I, P, Q), chưa tính tới PF/tần số.
 *
 * Bỏ: TOTAL_CURRENT (HES trả rỗng), góc pha, CTString/PTString (luôn "1/1").
 */
export const THONGSO_FIELDS = [
  ['U_A', 'PHASE_A_VOLTS', false],
  ['U_B', 'PHASE_B_VOLTS', false],
  ['U_C', 'PHASE_C_VOLTS', false],
  ['I_A', 'PHASE_A_AMPERE', true],
  ['I_B', 'PHASE_B_AMPERE', true],
  ['I_C', 'PHASE_C_AMPERE', true],
  ['P', 'TOTAL_KW', true],
  ['P_A', 'PHASE_A_KW', true],
  ['P_B', 'PHASE_B_KW', true],
  ['P_C', 'PHASE_C_KW', true],
  ['Q', 'TOTAL_KVAR', true],
  ['Q_A', 'PHASE_A_KVAR', true],
  ['Q_B', 'PHASE_B_KVAR', true],
  ['Q_C', 'PHASE_C_KVAR', true],
  ['PF', 'TOTAL_PF', false],
  ['F', 'FREQUENCE', false],
];
export const THONGSO_COLUMNS = ['METER_NO', 'DATE_TIME', ...THONGSO_FIELDS.map(f => f[0])];
const SCALED = new Set(THONGSO_FIELDS.filter(f => f[2]).map(f => f[0]));

/** Bản ghi HES → dòng RAW của file (giữ nguyên chuỗi số HES trả). */
export function rawRow(meterNo, rec) {
  const row = { METER_NO: meterNo, DATE_TIME: rec.DATE_TIME ?? rec.DATA_TIME ?? '' };
  for (const [col, src] of THONGSO_FIELDS) row[col] = rec[src] ?? '';
  return row;
}

/**
 * Dòng RAW → số đã quy đổi. Ô rỗng giữ `null` (KHÔNG đo được), khác 0.
 * @returns {object} cùng các cột, giá trị number | null
 */
export function scaleRow(row, hsn) {
  const out = { METER_NO: row.METER_NO, DATE_TIME: row.DATE_TIME };
  for (const [col] of THONGSO_FIELDS) {
    const s = row[col];
    const v = s === '' || s == null ? null : Number(s);
    out[col] = v === null || !Number.isFinite(v) ? null : (SCALED.has(col) ? v * hsn : v);
  }
  return out;
}

const day10 = (v) => String(v ?? '').slice(0, 10);

/**
 * Dựng hàm tra HSN theo (công tơ, thời điểm) từ Danh mục.
 *
 * Một lần treo khớp mốc khi `date_on ≤ ngày ≤ date_off` (date_off rỗng = đang
 * treo). Lấy CẢ ngày tháo: công tơ vẫn đo tới lúc tháo trong ngày đó. Hai lần treo
 * cùng khớp (tháo và treo lại cùng ngày) ⇒ ưu tiên lần treo MUỘN hơn.
 *
 * Lần treo thiếu `date_on` ⇒ KHÔNG dùng (không biết từ khi nào) — trả lý do, không
 * đoán HSN (user chốt 24/09/2026).
 *
 * @param assets bản ghi `dm_asset` (lọc type = CONGTO bên trong)
 * @param points bản ghi `dm_point`
 * @returns (serial, dateTime) → {hsn, point, asset} | {reason}
 */
export function buildHsnResolver(assets, points) {
  const pointById = new Map(points.map(p => [p.id, p]));
  const bySerial = new Map();
  for (const a of assets) {
    if (a.type !== 'CONGTO' || !a.serial) continue;
    const s = String(a.serial).trim();
    (bySerial.get(s) ?? bySerial.set(s, []).get(s)).push(a);
  }
  return function hsnAt(serial, dateTime) {
    const list = bySerial.get(String(serial).trim());
    if (!list) return { reason: 'KHONG_CO_TRONG_DANH_MUC' };
    const d = day10(dateTime);
    const hit = list
      .filter(a => day10(a.date_on) && day10(a.date_on) <= d && (!day10(a.date_off) || d <= day10(a.date_off)))
      .sort((x, y) => day10(y.date_on).localeCompare(day10(x.date_on)))[0];
    if (!hit) {
      return { reason: list.some(a => !day10(a.date_on)) ? 'THIEU_NGAY_TREO' : 'KHONG_TREO_NGAY_NAY' };
    }
    const p = pointById.get(hit.point);
    const hsn = Number(p?.hsn);
    if (!p) return { reason: 'KHONG_CO_DIEM_DO' };
    if (!Number.isFinite(hsn) || hsn <= 0) return { reason: 'DIEM_DO_THIEU_HSN' };
    return { hsn, point: p, asset: hit };
  };
}

/**
 * Các công tơ cần LẤY thông số cho khoảng ngày [from, to]: mọi lần treo có
 * khoảng giao với cửa sổ. Rộng hơn `liveMeters()` (chỉ đang treo) để backfill
 * vẫn có số của công tơ đã tháo giữa kỳ. Lần treo thiếu `date_on` vẫn LẤY (số RAW
 * không cần HSN) — nơi đọc sẽ báo THIEU_NGAY_TREO; khai ngày treo xong là nhân được
 * ngay mà không phải tải lại.
 */
export function metersForRange(assets, from, to) {
  const out = new Set();
  for (const a of assets) {
    if (a.type !== 'CONGTO' || !a.serial || !a.point) continue;
    const on = day10(a.date_on), off = day10(a.date_off);
    if (on && on > to) continue;
    if (off && off < from) continue;
    if (!on && off) continue;          // đã tháo, không rõ từ khi nào ⇒ bỏ
    out.add(String(a.serial).trim());
  }
  return [...out].sort();
}
