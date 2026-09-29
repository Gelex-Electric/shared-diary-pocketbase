/**
 * Thông số tức thời 30 phút — bản TS cho app. Đối chiếu: `scripts/lib/thongso.mjs`.
 *
 * `public/ThongSo_30min/<ngày>.csv` lưu **RAW**, không nhân HSN (user chốt 24/09/2026).
 * HSN thuộc ĐIỂM ĐO, không thuộc công tơ: công tơ tháo ở điểm này treo sang điểm khác
 * thì HSN đổi theo điểm. Nên nơi đọc phải tra: số công tơ → lần treo (`dm_asset`) chứa
 * ngày của mốc → `point` → `dm_point.hsn`.
 *
 * Nhờ vậy sửa HSN / ngày treo trong Danh mục là số lịch sử tự đúng theo, không phải
 * tải lại — khác `datametter.csv` đã nhân cứng HSN vào số lúc ghi.
 *
 * HAI BẢN PHẢI KHỚP NHAU. Sửa luật ở đây thì sửa cả `scripts/lib/thongso.mjs`;
 * `scripts/check_thongso_parity.mjs` chạy cả hai trên dữ liệu thật và so từng ô.
 */
import type { Asset, Point } from './dm/types';

/** Cột file → có nhân HSN hay không. Thứ tự đúng bằng thứ tự cột trong CSV. */
export const THONGSO_FIELDS: ReadonlyArray<readonly [string, boolean]> = [
  ['U_A', false], ['U_B', false], ['U_C', false],
  ['I_A', true], ['I_B', true], ['I_C', true],
  ['P', true], ['P_A', true], ['P_B', true], ['P_C', true],
  ['Q', true], ['Q_A', true], ['Q_B', true], ['Q_C', true],
  ['PF', false], ['F', false],
];
export const THONGSO_COLUMNS = ['METER_NO', 'DATE_TIME', ...THONGSO_FIELDS.map(f => f[0])];
const SCALED = new Set(THONGSO_FIELDS.filter(f => f[1]).map(f => f[0]));

/** Dòng RAW đọc từ file: mọi ô là chuỗi đúng như HES trả. */
export type RawRow = Record<string, string>;
/** Dòng đã quy đổi. `null` = KHÔNG đo được, khác hẳn 0. */
export type ScaledRow = { METER_NO: string; DATE_TIME: string } & Record<string, number | null | string>;

/** Dòng RAW → số đã quy đổi. Ô rỗng giữ `null` (KHÔNG đo được), khác 0. */
export function scaleRow(row: RawRow, hsn: number): ScaledRow {
  const out: ScaledRow = { METER_NO: row.METER_NO, DATE_TIME: row.DATE_TIME };
  for (const [col] of THONGSO_FIELDS) {
    const s = row[col];
    const v = s === '' || s == null ? null : Number(s);
    out[col] = v === null || !Number.isFinite(v) ? null : (SCALED.has(col) ? v * hsn : v);
  }
  return out;
}

const day10 = (v: unknown) => String(v ?? '').slice(0, 10);

/** Vì sao không tra được HSN — hiện ra màn hình chứ không lặng lẽ bỏ công tơ. */
export type HsnMiss =
  | 'KHONG_CO_TRONG_DANH_MUC'
  | 'THIEU_NGAY_TREO'
  | 'KHONG_TREO_NGAY_NAY'
  | 'KHONG_CO_DIEM_DO'
  | 'DIEM_DO_THIEU_HSN';
export type HsnHit = { hsn: number; point: Point; asset: Asset };
export type HsnResult = HsnHit | { reason: HsnMiss };
export const hsnOk = (r: HsnResult): r is HsnHit => 'hsn' in r;

/** Vì sao thiếu, nói bằng tiếng người — dùng cho thông báo trên màn hình. */
export const HSN_MISS_TEXT: Record<HsnMiss, string> = {
  KHONG_CO_TRONG_DANH_MUC: 'chưa khai trong Danh mục',
  THIEU_NGAY_TREO: 'lần treo chưa có ngày treo',
  KHONG_TREO_NGAY_NAY: 'ngày đó công tơ chưa treo hoặc đã tháo',
  KHONG_CO_DIEM_DO: 'lần treo không gắn điểm đo nào',
  DIEM_DO_THIEU_HSN: 'điểm đo chưa có HSN',
};

/**
 * Dựng hàm tra HSN theo (công tơ, thời điểm) từ Danh mục.
 *
 * Một lần treo khớp mốc khi `date_on ≤ ngày ≤ date_off` (date_off rỗng = đang treo).
 * Lấy CẢ ngày tháo: công tơ vẫn đo tới lúc tháo trong ngày đó. Hai lần treo cùng khớp
 * (tháo và treo lại cùng ngày) ⇒ ưu tiên lần treo MUỘN hơn.
 *
 * Lần treo thiếu `date_on` ⇒ KHÔNG dùng: không biết từ khi nào thì không được đoán
 * HSN (user chốt 24/09/2026).
 */
export function buildHsnResolver(assets: Asset[], points: Point[]) {
  const pointById = new Map(points.map(p => [p.id, p]));
  const bySerial = new Map<string, Asset[]>();
  for (const a of assets) {
    if (a.type !== 'CONGTO' || !a.serial) continue;
    const s = String(a.serial).trim();
    const list = bySerial.get(s);
    if (list) list.push(a); else bySerial.set(s, [a]);
  }
  return function hsnAt(serial: string, dateTime: string): HsnResult {
    const list = bySerial.get(String(serial).trim());
    if (!list) return { reason: 'KHONG_CO_TRONG_DANH_MUC' };
    const d = day10(dateTime);
    const hit = list
      .filter(a => day10(a.date_on) && day10(a.date_on) <= d && (!day10(a.date_off) || d <= day10(a.date_off)))
      .sort((x, y) => day10(y.date_on).localeCompare(day10(x.date_on)))[0];
    if (!hit) {
      return { reason: list.some(a => !day10(a.date_on)) ? 'THIEU_NGAY_TREO' : 'KHONG_TREO_NGAY_NAY' };
    }
    const p = hit.point ? pointById.get(hit.point) : undefined;
    if (!p) return { reason: 'KHONG_CO_DIEM_DO' };
    const hsn = Number(p.hsn);
    if (!Number.isFinite(hsn) || hsn <= 0) return { reason: 'DIEM_DO_THIEU_HSN' };
    return { hsn, point: p, asset: hit };
  };
}

/* ======================= đọc file từ thư mục public ======================= */

const BASE = '/ThongSo_30min';

/** `index.json` do script ghi: danh sách ngày đang có. */
export interface ThongSoIndex { days: string[]; first: string; last: string }

/**
 * Danh sách ngày có dữ liệu. KHÔNG nạp dữ liệu — mỗi ngày ~450 KB, 40 ngày là
 * 18 MB, tải hết về trình duyệt là hỏng. Màn hình chỉ nạp NGÀY ĐANG XEM.
 */
export async function loadThongSoIndex(): Promise<ThongSoIndex> {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as Partial<ThongSoIndex>;
  const days = Array.isArray(j.days) ? j.days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  return { days, first: days[0] ?? '', last: days[days.length - 1] ?? '' };
}

/** Tách CSV một ngày thành các dòng RAW. Cột lấy theo HEADER, không theo vị trí. */
export function parseThongSoCsv(text: string): RawRow[] {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const head = lines[0].split(',').map(h => h.trim());
  const out: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const c = line.split(',');
    const row: RawRow = {};
    head.forEach((h, k) => { row[h] = (c[k] ?? '').trim(); });
    if (row.METER_NO && row.DATE_TIME) out.push(row);
  }
  return out;
}

/** Cache theo NGÀY: đổi qua đổi lại giữa vài ngày thì không tải lại. */
const _dayCache = new Map<string, Promise<RawRow[]>>();

/** Dòng RAW của một ngày. Ngày không có file ⇒ mảng rỗng (không phải lỗi). */
export function loadThongSoDay(day: string): Promise<RawRow[]> {
  const hit = _dayCache.get(day);
  if (hit) return hit;
  const p = fetch(`${BASE}/${day}.csv`)
    .then(res => {
      if (res.status === 404) return '';
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(parseThongSoCsv)
    .catch(err => { _dayCache.delete(day); throw err; });
  _dayCache.set(day, p);
  return p;
}
