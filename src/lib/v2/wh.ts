/**
 * Tầng đọc bộ collection `wh_*` trên PocketBase PRODUCTION.
 *
 * Vì sao `wh_*` chứ không phải `v2_*` (user chốt 07/08): `wh_*` đã tồn tại thật
 * trên production và có sẵn `wh_movement` — sổ nhật ký treo/tháo. Dựng thêm bộ
 * thứ ba chỉ làm dữ liệu phân mảnh. Bộ `v2_*` vì thế KHÔNG được tạo.
 *
 * Luật nghiệp vụ vẫn nằm ở `rules.ts` và làm việc trên kiểu `V2Asset`; file này
 * lo phần dịch từ hình dạng `wh_device` sang kiểu đó (`toAsset`), để đổi nguồn
 * dữ liệu không phải sửa luật.
 */
import { pbv2, isAbort } from './pb';
import type { V2Asset, V2AssetStatus, V2AssetType, V2PointStatus } from './schema';

export const WH = {
  zone: 'wh_zone',
  station: 'wh_station',
  deviceType: 'wh_device_type',
  customer: 'wh_customer',
  point: 'wh_point',
  device: 'wh_device',
  movement: 'wh_movement',
} as const;

/**
 * Đơn vị = KCN, và cũng LÀ KHO của KCN đó (user chốt 07/08: mỗi KCN đúng một
 * kho nên bảng `wh_warehouse` đã bị bỏ). Đơn vị `GETC` chính là kho trung
 * chuyển. `code` là chuỗi dài ("KCN Yên Mỹ") vì `wh_point.zone` đang mang đúng
 * chuỗi đó; `short_code` (TH/PĐ/TTI/YM/03/GETC) chỉ để hiển thị.
 */
export interface WhZone {
  id: string; code: string; name: string;
  short_code?: string; warehouse_name?: string;
  order_index?: number; note?: string;
}
export interface WhStation {
  id: string; code: string; name?: string; zone?: string;
  mba?: string; cong_suat_kva?: number; note?: string;
}
export interface WhDeviceType { id: string; code: string; name: string; order_index?: number }
export interface WhCustomer { id: string; mkh: string; ten: string; tat?: string; zone?: string; trang_thai?: string }

export interface WhPoint {
  id: string;
  point_code: string;
  customer?: string;
  zone?: string;
  mba?: string;
  cong_suat_kva?: number;
  ngay_dong_dien?: string;
  ngay_thanh_ly?: string;
  trang_thai?: string;
  line_name?: string;
  /** Mã trạm dạng chữ, còn lại từ đợt nhập Excel. Khoá thật là `station`. */
  station_code?: string;
  /** relation → wh_station */
  station?: string;
  /** Vai trò điểm đo trong trạm. */
  role?: 'chinh' | 'phu' | '';
}

export interface WhDevice {
  id: string;
  serial: string;
  /** relation → wh_device_type */
  type: string;
  /** ME41 (gián tiếp) | ME42 (trực tiếp) — chỉ có ở công tơ. */
  model?: string;
  /** Tỷ số TI/TU dạng chữ, ví dụ "1600/5". */
  spec?: string;
  manufacturer?: string;
  year_made?: number;
  calib_date?: string;
  calib_expiry?: string;
  calib_cert_no?: string;
  nguon_goc?: string;
  status?: string;
  /** relation → wh_zone: đơn vị đang giữ thiết bị khi nó nằm trong kho. */
  zone?: string;
  current_point?: string;
  note?: string;
}

export interface WhMovement {
  id: string;
  device: string;
  action: 'nhap_kho' | 'chuyen_kho' | 'treo' | 'thao' | 'xuat_kho' | 'thanh_ly';
  event_date: string;
  from_zone?: string;
  to_zone?: string;
  from_point?: string;
  to_point?: string;
  chi_so?: number;
  reason?: string;
  doc_no?: string;
  performer?: string;
  note?: string;
}

export const MOVEMENT_LABEL: Record<WhMovement['action'], string> = {
  nhap_kho: 'Nhập kho', chuyen_kho: 'Chuyển kho', treo: 'Treo lên điểm đo',
  thao: 'Tháo về kho', xuat_kho: 'Xuất kho', thanh_ly: 'Thanh lý',
};

export interface WhData {
  zones: WhZone[];
  stations: WhStation[];
  deviceTypes: WhDeviceType[];
  customers: WhCustomer[];
  points: WhPoint[];
  devices: WhDevice[];
}

export const EMPTY_WH: WhData = {
  zones: [], stations: [], deviceTypes: [],
  customers: [], points: [], devices: [],
};

/**
 * Nạp toàn bộ danh mục. Quy mô vài trăm tới vài nghìn bản ghi nên nạp một lần
 * là hợp lý; RIÊNG `wh_movement` thì KHÔNG — sổ nhật ký chỉ đọc theo điểm đo
 * hoặc theo thiết bị đang xem (bài học bulk data trong ARCHITECTURE.md).
 */
export async function fetchWh(): Promise<WhData> {
  const opt = { requestKey: null } as const;
  const [zones, stations, deviceTypes, customers, points, devices] = await Promise.all([
    pbv2.collection(WH.zone).getFullList<WhZone>({ sort: 'order_index,code', ...opt }),
    pbv2.collection(WH.station).getFullList<WhStation>({ sort: 'code', ...opt }),
    pbv2.collection(WH.deviceType).getFullList<WhDeviceType>({ sort: 'order_index', ...opt }),
    pbv2.collection(WH.customer).getFullList<WhCustomer>({ sort: 'mkh', ...opt }),
    pbv2.collection(WH.point).getFullList<WhPoint>({ sort: 'point_code', ...opt }),
    pbv2.collection(WH.device).getFullList<WhDevice>({ sort: 'serial', ...opt }),
  ]);
  return { zones, stations, deviceTypes, customers, points, devices };
}

/** Lịch sử treo/tháo của MỘT điểm đo, mới nhất trước. */
export async function fetchPointHistory(pointId: string): Promise<WhMovement[]> {
  try {
    return await pbv2.collection(WH.movement).getFullList<WhMovement>({
      filter: `from_point="${pointId}" || to_point="${pointId}"`,
      sort: '-event_date,-created',
      requestKey: null,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    return [];
  }
}

/** Vòng đời của MỘT thiết bị, mới nhất trước. */
export async function fetchDeviceHistory(deviceId: string): Promise<WhMovement[]> {
  try {
    return await pbv2.collection(WH.movement).getFullList<WhMovement>({
      filter: `device="${deviceId}"`,
      sort: '-event_date,-created',
      requestKey: null,
    });
  } catch (e) {
    if (isAbort(e)) throw e;
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Dịch sang kiểu mà rules.ts hiểu
 * ------------------------------------------------------------------ */

/** "1600/5" → { primary: 1600, secondary: 5 }. Trả rỗng nếu không đọc được. */
export function parseSpec(spec?: string): { primary?: number; secondary?: number } {
  const m = (spec || '').match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return {};
  const primary = Number(m[1].replace(',', '.'));
  const secondary = Number(m[2].replace(',', '.'));
  return Number.isFinite(primary) && Number.isFinite(secondary) ? { primary, secondary } : {};
}

const STATUS_MAP: Record<string, V2AssetStatus> = {
  trong_kho: 'kho', dang_treo: 'dang_treo', da_thu_hoi: 'kho',
  da_xuat_kho: 'kho', thanh_ly: 'thanh_ly',
};

/**
 * Loại thiết bị theo cách luật hiểu.
 * `wh_device_type.code` chỉ nói "CONGTO"; ME-41 hay ME-42 nằm ở `model`, mà đó
 * mới là thứ quyết định có cần TI hay không (R3/R4).
 */
export function assetTypeOf(d: WhDevice, typeCode?: string): V2AssetType {
  const code = (typeCode || '').toUpperCase();
  if (code === 'TI') return 'TI';
  if (code === 'TU') return 'TU';
  if (code === 'GP03') return 'GP03';
  if (code === 'CONGTO') {
    const m = (d.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (m.includes('ME41')) return 'ME41';
    if (m.includes('ME42')) return 'ME42';
    if (m.includes('DTS27')) return 'DTS27';
    // Công tơ chưa khai model: coi là gián tiếp để luật ĐÒI TI thay vì âm thầm
    // cho HSN = 1. Thà báo thiếu còn hơn tính sai hệ số nhân.
    return 'ME41';
  }
  return 'KHAC';
}

export function toAsset(d: WhDevice, typeByIdCode: Map<string, string>): V2Asset {
  const type = assetTypeOf(d, typeByIdCode.get(d.type));
  const { primary, secondary } = parseSpec(d.spec);
  const ratio = primary && secondary ? primary / secondary : undefined;
  return {
    id: d.id,
    serial: d.serial,
    type,
    ratio_primary: primary,
    ratio_secondary: secondary,
    ratio,
    calibration_date: d.calib_date,
    next_calibration: d.calib_expiry,
    current_status: STATUS_MAP[d.status ?? ''] ?? 'kho',
    current_point: d.current_point,
    note: d.note,
  };
}

/**
 * Trạng thái điểm đo theo cách luật hiểu.
 * `wh_point.trang_thai` là chữ tiếng Việt tự do lấy từ Excel gốc nên phải dịch;
 * không khớp thì coi là "chưa vận hành" — mức nhẹ nhất không bỏ sót cảnh báo.
 */
export function pointStatusOf(p: WhPoint): V2PointStatus {
  const s = (p.trang_thai || '').toLowerCase();
  if (p.ngay_thanh_ly || s.includes('thanh lý') || s.includes('thu hồi')) return 'dismounted';
  if (s.includes('đang hoạt động') || s.includes('hoạt động')) return 'active';
  if (s.includes('dự kiến') || s.includes('chưa gán')) return 'du_kien';
  return 'chua_van_hanh';
}

/** Nhãn nhóm trạm cho cây. Chưa có dữ liệu trạm thì gom vào một nhóm rõ ràng. */
export const NO_STATION = '(chưa gán trạm)';
export const NO_ZONE = '(chưa gán KCN)';
