/**
 * Danh bạ công tơ (MeterInfoRow) — trước đây đọc từ /metterinfo.csv, nay ghép 2 nguồn PB:
 *   - `station_map` : topology trạm HES (LINE_ID/CODE/ROLE/LINE_NAME) + HSN(HES) + STATUS
 *                     + danh bạ HES làm FALLBACK. Chứa TẤT CẢ công tơ (gồm điểm đo chính
 *                     không phát hành hóa đơn).
 *   - `invoice`     : HSN CHUẨN (CCIS) + tên KH. Lấy kỳ hóa đơn MỚI NHẤT mỗi số công tơ
 *                     (SCT) → override HSN + CUSTOMER_NAME. Bị lọc theo area2 tài khoản.
 *
 * LƯU Ý override có chọn lọc:
 *   - HSN (METER_NAME): invoice CHUẨN → override (đây là mục tiêu chính, HES HSN hay sai).
 *   - CUSTOMER_NAME: invoice → override (chỉ hiển thị).
 *   - ADDRESS, CUSTOMER_CODE: GIỮ từ station_map (HES). KHÔNG override vì:
 *       + ADDRESS trong HES = TÊN KCN (dùng lọc khu vực ở VoltagePowerDashboard),
 *         còn invoice.DChiNMua = địa chỉ đường phố → override sẽ vỡ bộ lọc KCN.
 *       + CUSTOMER_CODE dùng để GOM nhóm khách (CustomerManager) → giữ HES cho ổn định.
 *
 * Giữ NGUYÊN interface MeterInfoRow để các consumer không phải sửa.
 * Yêu cầu đã đăng nhập (cả 2 collection đều listRule = auth).
 */
import { fetchAll } from './pbData';
import { pb } from './pocketbase';

export interface MeterInfoRow {
  _id: string;              // record id trong station_map (để sửa HSN)
  METER_NO: string;
  METER_NAME: string;       // HSN (chuỗi, để tương thích consumer cũ)
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
  hsn?: number; meter_model?: string; customer_code?: string; customer_name?: string;
  address?: string; status?: string;
}
interface InvoiceLite { SCT?: string; HSN?: number; NMua?: string; EndDate?: string; }

const s = (v: unknown): string => (v == null ? '' : String(v)).trim();

/** Cache ngắn: nhiều component gọi fetchMeterInfo cùng lúc → tránh tải lại. */
let _cache: { at: number; promise: Promise<MeterInfoRow[]> } | null = null;
const CACHE_MS = 60_000;

async function loadMeterInfo(): Promise<MeterInfoRow[]> {
  const [sm, inv] = await Promise.all([
    fetchAll<StationMapRec>('station_map'),
    // Chỉ field cần; sort giảm dần EndDate để bản ghi ĐẦU mỗi SCT là kỳ mới nhất.
    fetchAll<InvoiceLite>('invoice', { fields: 'SCT,HSN,NMua,EndDate', sort: '-EndDate' }),
  ]);

  const latestInv = new Map<string, InvoiceLite>();
  for (const r of inv) {
    const sct = s(r.SCT);
    if (sct && !latestInv.has(sct)) latestInv.set(sct, r); // đầu tiên = mới nhất (đã sort)
  }

  return sm.map((st): MeterInfoRow => {
    const no = s(st.meter_no);
    const iv = latestInv.get(no);
    // HSN: ưu tiên hóa đơn (chuẩn); thiếu (điểm đo không hóa đơn) → HSN từ HES.
    const hsn = iv && iv.HSN != null ? iv.HSN : (st.hsn ?? '');
    const invName = iv ? s(iv.NMua) : '';
    return {
      _id: s(st.id),
      METER_NO: no,
      METER_NAME: hsn === '' ? '' : String(hsn),
      METER_MODEL_DESC: s(st.meter_model),
      CUSTOMER_CODE: s(st.customer_code),                   // giữ HES (gom nhóm ổn định)
      CUSTOMER_NAME: invName || s(st.customer_name),        // ưu tiên tên từ hóa đơn
      ADDRESS: s(st.address),                                // giữ HES = tên KCN (lọc khu vực)
      LINE_NAME: s(st.line_name),
      LINE_ID: s(st.line_id),
      CODE: s(st.code),
      ROLE: s(st.role),
      STATUS: s(st.status),
    };
  });
}

export async function fetchMeterInfo(): Promise<MeterInfoRow[]> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_MS) return _cache.promise;
  const promise = loadMeterInfo();
  _cache = { at: now, promise };
  promise.catch(() => { _cache = null; }); // lỗi → không cache
  return promise;
}

/** Xóa cache danh bạ (gọi sau khi sửa HSN để lần fetch sau lấy giá trị mới). */
export function invalidateMeterInfoCache() { _cache = null; }

/**
 * Cập nhật hệ số nhân (HSN) do người dùng đặt → lưu vào `station_map.hsn`.
 * `id` = MeterInfoRow._id (record id station_map). PB kiểm quyền theo updateRule
 * (chỉ KCN của tài khoản; GETC sửa tất cả) → ném lỗi nếu không đủ quyền.
 */
export async function updateMeterHsn(id: string, hsn: number): Promise<void> {
  await pb.collection('station_map').update(id, { hsn });
  invalidateMeterInfoCache();
}

/** True nếu tài khoản hiện tại được phép sửa HSN của công tơ (khớp updateRule PB). */
export function canEditHsn(customerCode: string): boolean {
  const area2 = (pb.authStore.model as { area2?: string } | null)?.area2 ?? '';
  if (!pb.authStore.isValid) return false;
  if (area2 === '') return true;               // GETC/admin: sửa tất cả
  return (customerCode || '').includes(area2); // chỉ KCN của tài khoản
}
