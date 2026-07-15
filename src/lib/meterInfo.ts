/**
 * Danh bạ công tơ (MeterInfoRow) — trước đây đọc từ /metterinfo.csv, nay đọc thẳng
 * collection PB `station_map`:
 *   - Topology (LINE_ID/CODE/ROLE/LINE_NAME/CUSTOMER/ADDRESS/STATUS) — từ HES, pipeline
 *     ghi đè hằng ngày.
 *   - HSN (`hsn`) — pipeline đồng bộ TRỰC TIẾP từ hóa đơn mới nhất (không còn từ HES) mỗi
 *     ngày, nên đã "đúng sẵn" khi tới đây — KHÔNG cần frontend join `invoice` nữa (tránh
 *     tải cả bảng invoice chỉ để lấy HSN, đúng bài học "đọc on-demand, không load-all").
 *     Công tơ CHƯA có hóa đơn + CHƯA nhập tay → `hsn` rỗng (METER_NAME = '') — các nơi
 *     tính toán (tổn thất, công suất...) phải tự loại các công tơ này.
 *
 * Giữ NGUYÊN interface MeterInfoRow để các consumer không phải sửa.
 * Yêu cầu đã đăng nhập (station_map.listRule = auth).
 */
import { fetchAll } from './pbData';

export interface MeterInfoRow {
  _id: string;              // record id trong station_map (để sửa HSN)
  METER_NO: string;
  METER_NAME: string;       // HSN (chuỗi; rỗng = CHƯA có hóa đơn/chưa nhập tay)
  METER_MODEL_DESC: string;
  CUSTOMER_CODE: string;
  CUSTOMER_NAME: string;
  ADDRESS: string;
  LINE_NAME: string;
  LINE_ID: string;
  CODE: string;
  ROLE: string;   // 'chinh' | 'phu'
  STATUS: string;
}

interface StationMapRec {
  id?: string;
  meter_no?: string; line_id?: string; line_name?: string; code?: string; role?: string;
  hsn?: number | null; meter_model?: string; customer_code?: string; customer_name?: string;
  address?: string; status?: string;
}

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** Cache ngắn: nhiều component gọi fetchMeterInfo cùng lúc → tránh tải lại. */
let _cache: { at: number; promise: Promise<MeterInfoRow[]> } | null = null;
const CACHE_MS = 60_000;

async function loadMeterInfo(): Promise<MeterInfoRow[]> {
  const sm = await fetchAll<StationMapRec>('station_map');
  return sm.map((st): MeterInfoRow => ({
    _id: s(st.id),
    METER_NO: s(st.meter_no),
    METER_NAME: st.hsn == null ? '' : String(st.hsn),
    METER_MODEL_DESC: s(st.meter_model),
    CUSTOMER_CODE: s(st.customer_code),
    CUSTOMER_NAME: s(st.customer_name),
    ADDRESS: s(st.address),                                // = tên KCN (dùng lọc khu vực)
    LINE_NAME: s(st.line_name),
    LINE_ID: s(st.line_id),
    CODE: s(st.code),
    ROLE: s(st.role),
    STATUS: s(st.status),
  }));
}

export async function fetchMeterInfo(): Promise<MeterInfoRow[]> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_MS) return _cache.promise;
  const promise = loadMeterInfo();
  _cache = { at: now, promise };
  promise.catch(() => { _cache = null; }); // lỗi → không cache
  return promise;
}

/** Xóa cache danh bạ (gọi sau khi backend cập nhật để lần fetch sau lấy giá trị mới). */
export function invalidateMeterInfoCache() { _cache = null; }
