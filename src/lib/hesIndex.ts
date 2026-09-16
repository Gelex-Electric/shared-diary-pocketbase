/**
 * Reader cho public/hes_index_daily.csv — chỉ số đầu/cuối ngày do GitHub Action
 * (scripts/fetch_hes_index.py) sinh ra. Mỗi dòng = 1 công tơ × 1 ngày, với chỉ số
 * tại mốc 00:00 ngày đó (START) và 00:00 ngày kế tiếp (END).
 *
 * Sản lượng kỳ [A → B] (theo ngày, bao gồm cả 2 đầu) cho từng chỉ số:
 *   value = row[B].END − row[A].START          (đầu = A 00:00, cuối = B+1 00:00)
 *   kWh   = value × HSN
 */

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

/** CSV line parser hỗ trợ field có dấu phẩy trong ngoặc kép. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export interface HesIndexData {
  /** meterNo → (date → row) */
  byMeter: Map<string, Map<string, HesIndexRow>>;
  /** Danh sách ngày có dữ liệu, tăng dần. */
  dates: string[];
}

/** Tải + parse CSV thành cấu trúc tra cứu nhanh theo (công tơ, ngày). */
export async function fetchHesIndex(): Promise<HesIndexData> {
  const res = await fetch('/hes_index_daily.csv', { cache: 'no-cache' });
  // Chưa có file (workflow chưa chạy lần nào) → coi như rỗng, không báo lỗi.
  if (res.status === 404) return { byMeter: new Map(), dates: [] };
  if (!res.ok) throw new Error('Không tải được hes_index_daily.csv');
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const byMeter = new Map<string, Map<string, HesIndexRow>>();
  const dateSet = new Set<string>();
  if (lines.length <= 1) return { byMeter, dates: [] };

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: any = {};
    headers.forEach((h, j) => { row[h] = (cols[j] ?? '').trim(); });
    const no = row.METER_NO as string;
    const date = row.DATE as string;
    if (!no || !date) continue;
    if (!byMeter.has(no)) byMeter.set(no, new Map());
    byMeter.get(no)!.set(date, row as HesIndexRow);
    dateSet.add(date);
  }
  return { byMeter, dates: [...dateSet].sort() };
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
