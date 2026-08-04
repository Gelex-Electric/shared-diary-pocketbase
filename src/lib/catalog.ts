/**
 * Tầng đọc danh mục PocketBase: dm_zone / dm_station / dm_customer /
 * dm_point / dm_point_customer.
 *
 * Xem `plans/2026-08-03-mo-hinh-danh-muc-va-kho-vat-tu.md`.
 *
 * Quy mô hiện tại ~412 bản ghi nên nạp toàn bộ một lần là hợp lý. KHÔNG áp
 * cách này cho dữ liệu đo đếm (tloss/datametter) — bulk data phải query theo
 * filter, bài học đã ghi trong ARCHITECTURE.md.
 */
import { pb } from './pocketbase';

export type PointRole = 'chinh' | 'phu' | '';
export type PointStatus = 'du_kien' | 'chua_van_hanh' | 'active' | 'dismounted' | '';

export interface Zone {
  id: string;
  code: string;
  name: string;
  area_label: string;
}

export interface Station {
  id: string;
  code: string;
  name: string;
  zone: string;
  sdm_kva?: number;
  p0_kw?: number;
  pk_kw?: number;
  note?: string;
}

export interface Customer {
  id: string;
  mkh: string;
  name: string;
  address?: string;
  zone: string;
  active?: boolean;
}

export interface Point {
  id: string;
  line_id: string;
  line_name: string;
  station: string;
  zone: string;
  role: PointRole;
  voltage_level?: 'LV' | 'MV' | '';
  point_status: PointStatus;
  hsn_invoice?: number;
  hsn_calc?: number;
  hsn_mismatch?: boolean;
  note?: string;
}

export interface PointCustomer {
  id: string;
  point: string;
  customer: string;
  mkh: string;
  from_date: string;
  to_date: string;
  is_current: boolean;
  shared: boolean;
}

export type AssetType = 'ME41' | 'ME42' | 'DTS27' | 'TI' | 'TU' | 'SIM' | 'GP03' | 'KHAC';

/** Loại là CÔNG TƠ — thay cho việc so `type === 'CONGTO'` cũ. */
export const METER_TYPES: AssetType[] = ['ME41', 'ME42', 'DTS27'];
export const isMeter = (t: string) => METER_TYPES.includes(t as AssetType);

/** Loại có tỷ số biến đổi (tham gia công thức HSN). */
export const RATIO_TYPES: AssetType[] = ['TI', 'TU'];
export const hasRatio = (t: string) => RATIO_TYPES.includes(t as AssetType);

/** GP-03 và SIM là thiết bị truyền dữ liệu — không kiểm định. */
export const NO_CALIBRATION: AssetType[] = ['GP03', 'SIM'];
export const needsCalibration = (t: string) => !NO_CALIBRATION.includes(t as AssetType);

/** Số năm giữa 2 lần kiểm định: công tơ 3 năm, TI/TU 5 năm (user chốt 03/08). */
export const calibrationSpan = (t: string): number | null =>
  !needsCalibration(t) ? null : isMeter(t) ? 3 : 5;
export type AssetStatus =
  | 'kho' | 'dang_treo' | 'cho_kiem_dinh' | 'dang_kiem_dinh'
  | 'dat' | 'khong_dat' | 'thanh_ly' | '';

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  zone: string;
  active?: boolean;
}

export interface Asset {
  id: string;
  serial: string;
  type: AssetType;
  model_desc?: string;
  manufacturer?: string;
  ratio_primary?: number;
  ratio_secondary?: number;
  ratio?: number;
  manufacture_year?: number;
  calibration_date?: string;
  next_calibration?: string;
  current_status: AssetStatus;
  current_warehouse: string;
  current_point: string;
  hes_seen?: boolean;
  note?: string;
}

export interface Install {
  id: string;
  asset: string;
  serial: string;
  type: AssetType;
  point: string;
  phase?: 'A' | 'B' | 'C' | '';
  from_date: string;
  to_date: string;
  is_current: boolean;
  note?: string;
}

export interface CatalogData {
  zones: Zone[];
  stations: Station[];
  customers: Customer[];
  points: Point[];
  periods: PointCustomer[];
  warehouses: Warehouse[];
  assets: Asset[];
  installs: Install[];
}

export const ASSET_TYPE_LABEL: Record<string, string> = {
  ME41: 'ME-41', ME42: 'ME-42', DTS27: 'DTS27',
  TI: 'TI', TU: 'TU', SIM: 'SIM', GP03: 'GP-03', KHAC: 'Khác',
};

/** Thứ tự hiển thị trong bộ lọc / bộ chọn. */
export const ASSET_TYPES: AssetType[] = ['ME41', 'ME42', 'DTS27', 'TI', 'TU', 'SIM', 'GP03', 'KHAC'];

export const ASSET_STATUS_LABEL: Record<string, string> = {
  kho: 'Trong kho', dang_treo: 'Đang treo', cho_kiem_dinh: 'Chờ kiểm định',
  dang_kiem_dinh: 'Đang kiểm định', dat: 'Kiểm định đạt',
  khong_dat: 'Kiểm định không đạt', thanh_ly: 'Đã thanh lý', '': '—',
};

/** Vật tư đang treo tại một điểm đo (kỳ `is_current`). */
export function assetsAtPoint(data: CatalogData, pointId: string): Array<{ install: Install; asset?: Asset }> {
  return data.installs
    .filter(i => i.point === pointId && i.is_current)
    .map(i => ({ install: i, asset: data.assets.find(a => a.id === i.asset) }));
}

/** Quá hạn kiểm định? GP-03 và SIM không kiểm định nên luôn false. */
export function isOverdue(a: Asset, today = new Date()): boolean {
  if (!needsCalibration(a.type) || !a.next_calibration) return false;
  return a.next_calibration.slice(0, 10) < today.toISOString().slice(0, 10);
}

/** Nạp toàn bộ danh mục. Ném lỗi để component quyết định cách báo. */
export async function fetchCatalog(): Promise<CatalogData> {
  const [zones, stations, customers, points, periods, warehouses, assets, installs] = await Promise.all([
    pb.collection('dm_zone').getFullList<Zone>({ sort: 'code' }),
    pb.collection('dm_station').getFullList<Station>({ sort: 'code' }),
    pb.collection('dm_customer').getFullList<Customer>({ sort: 'mkh' }),
    pb.collection('dm_point').getFullList<Point>({ sort: 'line_name' }),
    pb.collection('dm_point_customer').getFullList<PointCustomer>({ sort: '-from_date' }),
    pb.collection('vt_warehouse').getFullList<Warehouse>({ sort: 'code' }),
    pb.collection('vt_asset').getFullList<Asset>({ sort: 'serial' }),
    pb.collection('vt_install').getFullList<Install>({ sort: '-from_date' }),
  ]);
  return { zones, stations, customers, points, periods, warehouses, assets, installs };
}

/** Nhãn tiếng Việt cho trạng thái điểm đo. */
export const POINT_STATUS_LABEL: Record<string, string> = {
  du_kien: 'Dự kiến',
  chua_van_hanh: 'Chưa vận hành',
  active: 'Đang vận hành',
  dismounted: 'Đã tháo',
  '': '—',
};

/** Ngày dạng `2026-07-20 00:00:00.000Z` → `20/07/2026`. */
export function viDate(v?: string): string {
  const d = (v || '').slice(0, 10);
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}

/**
 * Kỳ khách hàng của một điểm đo, mới nhất trước.
 * `periods` đã sort `-from_date` từ server nên chỉ cần lọc.
 */
export function periodsOfPoint(periods: PointCustomer[], pointId: string): PointCustomer[] {
  return periods.filter(p => p.point === pointId);
}

/** Khách hàng đang dùng điểm đo (kỳ `is_current`). Rỗng nếu chưa có kỳ nào. */
export function currentCustomerOf(
  periods: PointCustomer[],
  customers: Customer[],
  pointId: string,
): { period: PointCustomer; customer?: Customer } | null {
  const cur = periods.find(p => p.point === pointId && p.is_current);
  if (!cur) return null;
  return { period: cur, customer: customers.find(c => c.id === cur.customer) };
}
