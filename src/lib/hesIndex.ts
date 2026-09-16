/**
 * Reader cho chỉ số đầu/cuối ngày, nguồn là collection `hes_index` trên
 * PocketBase do `scripts/fetch_hes_index.mjs` ghi mỗi đêm. Mỗi bản ghi =
 * 1 công tơ × 1 ngày, chỉ số tại mốc 00:00 ngày đó (START) và 00:00 ngày kế
 * tiếp (END).
 *
 * Sản lượng kỳ [A → B] (theo ngày, bao gồm cả 2 đầu) cho từng chỉ số:
 *   value = row[B].END − row[A].START          (đầu = A 00:00, cuối = B+1 00:00)
 *   kWh   = value × HSN
 *
 * Trước 16/09/2026 đọc `public/hes_index_daily.csv`. Bỏ vì thư mục `public/`
 * phục vụ công khai — ai biết URL đều tải được toàn bộ chỉ số đo đếm mà không
 * cần đăng nhập. Bản đọc CSV đã gỡ hẳn để không tồn tại hai nguồn song song.
 */

import { pb } from './pocketbase';

export type HesField = 'PG' | 'BT' | 'CD' | 'TD' | 'VC';
export const HES_FIELDS: HesField[] = ['PG', 'BT', 'CD', 'TD', 'VC'];

export interface HesIndexRow {
  METER_NO: string;
  DATE: string;        // "YYYY-MM-DD"
  HSN: string;
  START_TIME: string;
  END_TIME: string;
  // PG_START, PG_END, ... VC_START, VC_END
  [k: string]: string;
}

export interface HesIndexData {
  /** meterNo → (date → row) */
  byMeter: Map<string, Map<string, HesIndexRow>>;
  /** Danh sách ngày có dữ liệu, tăng dần. */
  dates: string[];
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

export interface Consumption {
  startTime: string;
  endTime: string;
  hsn: number;
  /** kWh/kVarh đã nhân HSN, làm tròn; null nếu thiếu dữ liệu một trong hai biên. */
  values: Record<HesField, number | null>;
}

/* ===================== Nguồn PocketBase (thay CSV) =====================

   Vì sao đổi (user chốt 16/09/2026): `hes_index_daily.csv` nằm trong `public/`
   nên ai biết URL đều tải được toàn bộ chỉ số đo đếm mà không cần đăng nhập.
   Collection `hes_index` yêu cầu đăng nhập mới đọc được.

   Đổi nguồn còn rẻ hơn hẳn: sản lượng kỳ [A → B] chỉ cần dòng của ĐÚNG hai ngày
   A và B (xem `computeConsumption`), tức ~2 × số công tơ bản ghi — thay vì tải
   cả file 21.108 dòng rồi vứt gần hết.
*/

/** Tên cột PB (viết thường) → tên cột kiểu CSV mà `computeConsumption` đang dùng. */
function rowFromPb(rec: any): HesIndexRow {
  const row: any = {
    METER_NO: String(rec.meter_no ?? ''),
    DATE: String(rec.date ?? ''),
    HSN: rec.hsn == null ? '' : String(rec.hsn),
    START_TIME: String(rec.start_time ?? ''),
    END_TIME: String(rec.end_time ?? ''),
    REGRESS: String(rec.regress ?? ''),
    NO_DATA: rec.no_data ? '1' : '',
  };
  for (const f of HES_FIELDS) {
    const lo = f.toLowerCase();
    row[`${f}_START`] = rec[`${lo}_start`] == null ? '' : String(rec[`${lo}_start`]);
    row[`${f}_END`] = rec[`${lo}_end`] == null ? '' : String(rec[`${lo}_end`]);
  }
  return row as HesIndexRow;
}

/** Ngày cũ nhất / mới nhất có dữ liệu, để đặt mặc định và hiện khoảng tra được. */
export async function fetchHesIndexBounds(): Promise<{ first: string; last: string }> {
  const one = async (sort: string) => {
    const r = await pb.collection('hes_index').getList(1, 1, { sort, fields: 'date' });
    return (r.items[0] as any)?.date ?? '';
  };
  const [first, last] = await Promise.all([one('date'), one('-date')]);
  return { first, last };
}

/**
 * Chỉ số của ĐÚNG những ngày được yêu cầu (thường là 2: đầu kỳ và cuối kỳ).
 * Trả về đúng cấu trúc `HesIndexData` như bản CSV nên nơi gọi không phải đổi.
 */
export async function fetchHesIndexDays(days: string[]): Promise<HesIndexData> {
  const wanted = [...new Set(days.filter(Boolean))];
  const byMeter = new Map<string, Map<string, HesIndexRow>>();
  if (!wanted.length) return { byMeter, dates: [] };

  const filter = wanted.map(d => `date="${d}"`).join(' || ');
  const items = await pb.collection('hes_index').getFullList({ filter, batch: 500 });
  for (const rec of items) {
    const row = rowFromPb(rec);
    if (!row.METER_NO || !row.DATE) continue;
    if (!byMeter.has(row.METER_NO)) byMeter.set(row.METER_NO, new Map());
    byMeter.get(row.METER_NO)!.set(row.DATE, row);
  }
  return { byMeter, dates: wanted.sort() };
}

/**
 * Tính sản lượng cho 1 công tơ trong kỳ [startDate → endDate] (bao gồm cả hai ngày).
 * Lấy START từ dòng startDate và END từ dòng endDate.
 */
export function computeConsumption(
  data: HesIndexData,
  meterNo: string,
  startDate: string,
  endDate: string,
  hsnFallback = 1,
): Consumption | null {
  const rows = data.byMeter.get(meterNo);
  if (!rows) return null;
  const startRow = rows.get(startDate);
  const endRow = rows.get(endDate);
  if (!startRow || !endRow) return null;

  const hsn = num(endRow.HSN) ?? num(startRow.HSN) ?? hsnFallback;
  const values = {} as Record<HesField, number | null>;
  for (const f of HES_FIELDS) {
    const a = num(startRow[`${f}_START`]);
    const b = num(endRow[`${f}_END`]);
    values[f] = a === null || b === null ? null : Math.round((b - a) * hsn);
  }
  return { startTime: startRow.START_TIME, endTime: endRow.END_TIME, hsn, values };
}
