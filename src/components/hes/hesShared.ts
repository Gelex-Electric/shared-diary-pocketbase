/**
 * Những thứ dùng chung của các màn HES: hình dạng một dòng công tơ, một ô sản
 * lượng đã tính, và mấy hàm định dạng.
 *
 * Trước 16/09/2026 chúng nằm trong `useHesConsumption.ts` — hook của tab "Số
 * liệu đã chốt". Tab đó đã bỏ, nhưng tab "Gọi HES ngay" và bảng sản lượng vẫn
 * cần, nên tách ra đây thay vì bắt một hook đã chết sống tiếp chỉ vì vài hàm.
 */

export interface MeterRow {
  id: string;
  MeterNo: string;
  HSN: string;
  Line: string;
  area: string;
}

/** Một ô sản lượng đã tính xong — hình dạng tối thiểu mà bảng cần. */
export interface ConsumptionCell {
  startTime: string;
  endTime: string;
  hsn: number;
  values: Record<string, number | null>;
}

/** Số → chuỗi kiểu Việt Nam, `null` thành gạch ngang. */
export const fmt = (val: number | null) =>
  val === null ? '—' : val.toLocaleString('vi-VN', { maximumFractionDigits: 0 });

/** "YYYY-MM-DD HH:mm:ss" → "dd/MM HH:mm"; rỗng thành gạch ngang. */
export const fmtTime = (raw?: string): string => {
  if (!raw) return '—';
  const d = new Date(raw.replace(' ', 'T'));
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Id công tơ tiêu thụ lớn nhất (để tô nổi bật). '' nếu chưa có số nào. */
export function maxTotalMeterId(
  rows: MeterRow[],
  consumptions: Map<string, ConsumptionCell | null>,
): string {
  let bestId = ''; let best = -Infinity;
  for (const m of rows) {
    const total = consumptions.get(m.MeterNo)?.values.PG ?? null;
    if (total !== null && total > best) { best = total; bestId = m.id; }
  }
  return best > 0 ? bestId : '';
}

/** Một dòng cho file Excel. Dùng chung để các màn xuất cùng bộ cột. */
export const toExportRow = (m: MeterRow, c?: ConsumptionCell | null) => ({
  'Số công tơ':        m.MeterNo,
  'Trạm':              m.Line || '',
  'Hệ số nhân':        m.HSN || '',
  'Thời gian đầu kỳ':  fmtTime(c?.startTime),
  'Thời gian cuối kỳ': fmtTime(c?.endTime),
  'Tổng (kWh)':        c?.values.PG ?? '',
  'Biểu 1 (kWh)':      c?.values.BT ?? '',
  'Biểu 2 (kWh)':      c?.values.CD ?? '',
  'Biểu 3 (kWh)':      c?.values.TD ?? '',
  'Vô công (kVarh)':   c?.values.VC ?? '',
});
