/**
 * Reader cho chỉ số công tơ tại từng mốc 30 phút, do `scripts/fetch_hes_index.mjs`
 * sinh mỗi đêm vào `public/ChiSo_30min/` — MỖI NGÀY MỘT FILE, giữ 30 ngày gần nhất,
 * kèm `index.json` liệt kê các ngày đang có.
 *
 * Mỗi dòng = 1 công tơ × 1 mốc. Chỉ số lưu RAW, CHƯA nhân HSN — cột `HSN` đi
 * kèm (lấy từ `dm_point.hsn` của Danh mục) để nơi đọc tự nhân.
 *
 * Sản lượng kỳ [mốc A → mốc B]:
 *   value = row[B] − row[A]
 *   kWh   = value × HSN
 *
 * Khác bản chỉ số NGÀY ở chỗ hai đầu kỳ là mốc 30 phút bất kỳ, không bắt buộc
 * 00:00 — đó là lý do lấy dữ liệu này về.
 */

export type HesField = 'PG' | 'BT' | 'CD' | 'TD' | 'VC';
export const HES_FIELDS: HesField[] = ['PG', 'BT', 'CD', 'TD', 'VC'];

/** Nhãn tiếng Việt của từng chỉ số, dùng chung cho bảng và file Excel. */
export const HES_FIELD_LABEL: Record<HesField, string> = {
  PG: 'Tổng', BT: 'Biểu 1', CD: 'Biểu 2', TD: 'Biểu 3', VC: 'Vô công',
};

export interface Hes30Row {
  METER_NO: string;
  /** "YYYY-MM-DD HH:mm:ss" */
  DATE_TIME: string;
  HSN: string;
  [k: string]: string;
}

export interface Hes30Data {
  /** meterNo → (dateTime → dòng) */
  byMeter: Map<string, Map<string, Hes30Row>>;
  /** Mọi mốc có trong file, tăng dần — để gợi ý khoảng tra được. */
  stamps: string[];
}

/** CSV của pipeline không có dấu phẩy trong ô, nhưng vẫn xử lý ngoặc kép cho chắc. */
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

/** Dựng cấu trúc tra cứu từ nội dung CSV. Tách riêng để kiểm thử không cần mạng. */
export function parseHes30(text: string): Hes30Data {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const byMeter = new Map<string, Map<string, Hes30Row>>();
  const stampSet = new Set<string>();
  if (lines.length <= 1) return { byMeter, stamps: [] };

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const row: any = {};
    headers.forEach((h, j) => { row[h] = (cols[j] ?? '').trim(); });
    const no = row.METER_NO as string;
    const at = row.DATE_TIME as string;
    if (!no || !at) continue;
    if (!byMeter.has(no)) byMeter.set(no, new Map());
    byMeter.get(no)!.set(at, row as Hes30Row);
    stampSet.add(at);
  }
  return { byMeter, stamps: [...stampSet].sort() };
}

/** Thư mục chứa file 30 phút, mỗi ngày một file `YYYY-MM-DD.csv`. */
const DIR = '/ChiSo_30min';

/** Danh mục ngày đang có, do pipeline ghi kèm. Nhỏ (~1 KB), tải một lần. */
export interface Hes30Index { days: string[]; first: string; last: string }

const EMPTY_INDEX: Hes30Index = { days: [], first: '', last: '' };

/*
  KHÔNG tin vào mã HTTP để biết file có tồn tại hay không.

  Máy chủ phục vụ SPA trả về `index.html` kèm mã 200 cho MỌI đường dẫn không
  khớp file nào (đã đo trên dev server: `/ChiSo_30min/2020-01-01.csv` → 200,
  content-type text/html). Cứ `res.ok` là parse thì ta đem HTML đi đọc như CSV
  và ra một mớ dữ liệu rác trông như thật. Vì vậy phải KIỂM NỘI DUNG.
*/
export async function fetchHes30Index(): Promise<Hes30Index> {
  try {
    const res = await fetch(`${DIR}/index.json`, { cache: 'no-cache' });
    if (!res.ok) return EMPTY_INDEX;
    const text = await res.text();
    if (!text.trimStart().startsWith('{')) return EMPTY_INDEX;   // HTML trả nhầm
    const j = JSON.parse(text);
    return Array.isArray(j?.days) ? j : EMPTY_INDEX;
  } catch {
    // Pipeline chưa chạy lần nào, hoặc file hỏng → coi như chưa có dữ liệu.
    return EMPTY_INDEX;
  }
}

/**
 * Tải chỉ số của ĐÚNG những ngày cần (thường là 2: ngày đầu kỳ và ngày cuối kỳ).
 *
 * Đây là lý do tách mỗi ngày một file: tra một kỳ dài bao nhiêu cũng chỉ cần hai
 * đầu mút, nên tải 2 file ~770 KB thay vì trọn 11,7 MB của 30 ngày.
 *
 * Ngày không có file thì bỏ qua, để `consumptionBetween` báo đúng mốc nào thiếu
 * — chứ không làm hỏng cả lượt tải.
 */
export async function fetchHes30Days(days: string[]): Promise<Hes30Data> {
  const wanted = [...new Set(days.filter(Boolean))];
  const byMeter = new Map<string, Map<string, Hes30Row>>();
  const stampSet = new Set<string>();

  const texts = await Promise.all(wanted.map(async d => {
    try {
      const res = await fetch(`${DIR}/${d}.csv`, { cache: 'no-cache' });
      if (!res.ok) return '';
      const text = await res.text();
      /* Chặn HTML do SPA fallback trả về kèm mã 200 — xem ghi chú ở fetchHes30Index. */
      return text.startsWith('METER_NO,') ? text : '';
    } catch {
      return '';
    }
  }));

  for (const text of texts) {
    if (!text) continue;
    const part = parseHes30(text);
    for (const [no, rows] of part.byMeter) {
      if (!byMeter.has(no)) byMeter.set(no, new Map());
      const target = byMeter.get(no)!;
      for (const [at, row] of rows) target.set(at, row);
    }
    for (const s of part.stamps) stampSet.add(s);
  }
  return { byMeter, stamps: [...stampSet].sort() };
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
};

/** Ghép ngày + giờ người dùng chọn thành khoá tra cứu của file. */
export const stampOf = (date: string, time: string): string =>
  date && time ? `${date} ${time.length === 5 ? `${time}:00` : time}` : '';

export interface Consumption30 {
  startAt: string;
  endAt: string;
  hsn: number;
  /** kWh/kVarh đã nhân HSN, làm tròn. */
  values: Record<HesField, number | null>;
}

/**
 * Vì sao không tính được — để màn hình nói rõ thay vì hiện ô trống.
 *
 * `no-meter` : công tơ không có dòng nào trong file (chưa treo, hoặc mất đo xa
 *              suốt 30 ngày).
 * `no-start` / `no-end` : có công tơ nhưng thiếu ĐÚNG mốc đó — thường do HES
 *              không đẩy bản ghi tại mốc ấy, không phải do chọn sai.
 */
export type Missing30 = 'no-meter' | 'no-start' | 'no-end';

export interface Result30 {
  value: Consumption30 | null;
  missing?: Missing30;
}

/** Sản lượng của một công tơ giữa hai mốc 30 phút. */
export function consumptionBetween(
  data: Hes30Data,
  meterNo: string,
  startAt: string,
  endAt: string,
  hsnFallback = 1,
): Result30 {
  const rows = data.byMeter.get(meterNo);
  if (!rows) return { value: null, missing: 'no-meter' };
  const a = rows.get(startAt);
  if (!a) return { value: null, missing: 'no-start' };
  const b = rows.get(endAt);
  if (!b) return { value: null, missing: 'no-end' };

  const hsn = num(b.HSN) ?? num(a.HSN) ?? hsnFallback;
  const values = {} as Record<HesField, number | null>;
  for (const f of HES_FIELDS) {
    const x = num(a[f]);
    const y = num(b[f]);
    values[f] = x === null || y === null ? null : Math.round((y - x) * hsn);
  }
  return { value: { startAt, endAt, hsn, values } };
}

/** Ngày cũ nhất / mới nhất có dữ liệu, dạng "YYYY-MM-DD". */
export function dayRangeOf(data: Hes30Data): { first: string; last: string } {
  if (!data.stamps.length) return { first: '', last: '' };
  return {
    first: data.stamps[0].slice(0, 10),
    last: data.stamps[data.stamps.length - 1].slice(0, 10),
  };
}

/**
 * Các mốc giờ CÓ THẬT trong một ngày, dạng "HH:mm" — để gợi ý thay vì bắt người
 * dùng đoán.
 *
 * Mặc định chỉ trả mốc CHUẨN (phút 00 hoặc 30). Lý do: một số công tơ đẩy bản
 * ghi lệch vài phút (00:01, 00:03…), gộp hết lại thì một ngày ra hơn 130 mốc
 * trong khi tuyệt đại đa số công tơ chỉ có 48. Người dùng chọn phải mốc lẻ đó
 * thì gần như công tơ nào cũng báo thiếu dữ liệu — gợi ý như vậy là hại.
 *
 * `all = true` trả về mọi mốc, dùng khi cần soi đúng một công tơ lệch giờ.
 */
export function timesOfDay(data: Hes30Data, date: string, all = false): string[] {
  if (!date) return [];
  const out = new Set<string>();
  for (const s of data.stamps) {
    if (s.slice(0, 10) !== date) continue;
    const hm = s.slice(11, 16);
    if (all || hm.endsWith(':00') || hm.endsWith(':30')) out.add(hm);
  }
  return [...out].sort();
}
