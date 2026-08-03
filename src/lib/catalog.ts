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
export type PointStatus = 'du_kien' | 'active' | 'sub_meter' | 'dismounted' | '';

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

export interface CatalogData {
  zones: Zone[];
  stations: Station[];
  customers: Customer[];
  points: Point[];
  periods: PointCustomer[];
}

/** Nạp toàn bộ danh mục. Ném lỗi để component quyết định cách báo. */
export async function fetchCatalog(): Promise<CatalogData> {
  const [zones, stations, customers, points, periods] = await Promise.all([
    pb.collection('dm_zone').getFullList<Zone>({ sort: 'code' }),
    pb.collection('dm_station').getFullList<Station>({ sort: 'code' }),
    pb.collection('dm_customer').getFullList<Customer>({ sort: 'mkh' }),
    pb.collection('dm_point').getFullList<Point>({ sort: 'line_name' }),
    pb.collection('dm_point_customer').getFullList<PointCustomer>({ sort: '-from_date' }),
  ]);
  return { zones, stations, customers, points, periods };
}

/** Nhãn tiếng Việt cho trạng thái điểm đo. */
export const POINT_STATUS_LABEL: Record<string, string> = {
  du_kien: 'Dự kiến',
  active: 'Đang vận hành',
  sub_meter: 'Điểm đo phụ',
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
