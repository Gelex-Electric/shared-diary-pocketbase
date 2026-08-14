/**
 * Tầng truy cập PocketBase DUY NHẤT cho nhóm collection danh mục `dm_*`.
 *
 * Vì sao có file này: rà soát 14/08 chỉ ra 22/32 component gọi thẳng
 * `pb.collection(...)` (42 chỗ) nên đổi schema là phải sửa rải rác. Module mới
 * đi qua đây, không gọi `pb` trực tiếp từ component.
 *
 * Quy mô danh mục nhỏ (vài trăm bản ghi) nên nạp toàn bộ một lần là hợp lý.
 * KHÔNG áp cách này cho dữ liệu đo đếm — bulk data phải query theo filter.
 */
import { pb } from '../pocketbase';
import type { Asset, Customer, Point, Station, Zone } from './types';

/** Nạp hết một collection, sắp xếp theo `sort`. PocketBase batch tối đa 500/lần. */
async function all<T>(collection: string, sort: string): Promise<T[]> {
  const items = await pb.collection(collection).getFullList({ sort, batch: 500 });
  return items as unknown as T[];
}

export const zones = {
  list: () => all<Zone>('dm_zone', 'code'),
  create: (data: Partial<Zone>) => pb.collection('dm_zone').create(data),
  update: (id: string, data: Partial<Zone>) => pb.collection('dm_zone').update(id, data),
  remove: (id: string) => pb.collection('dm_zone').delete(id),
};

export const stations = {
  list: () => all<Station>('dm_station', 'code'),
  create: (data: Partial<Station>) => pb.collection('dm_station').create(data),
  update: (id: string, data: Partial<Station>) => pb.collection('dm_station').update(id, data),
  remove: (id: string) => pb.collection('dm_station').delete(id),
};

export const customers = {
  list: () => all<Customer>('dm_customer', 'mkh'),
  create: (data: Partial<Customer>) => pb.collection('dm_customer').create(data),
  update: (id: string, data: Partial<Customer>) => pb.collection('dm_customer').update(id, data),
  remove: (id: string) => pb.collection('dm_customer').delete(id),
};

export const points = {
  list: () => all<Point>('dm_point', 'line_name'),
  create: (data: Partial<Point>) => pb.collection('dm_point').create(data),
  update: (id: string, data: Partial<Point>) => pb.collection('dm_point').update(id, data),
  remove: (id: string) => pb.collection('dm_point').delete(id),
};

export const assets = {
  list: () => all<Asset>('dm_asset', 'type'),
  create: (data: Partial<Asset>) => pb.collection('dm_asset').create(data),
  update: (id: string, data: Partial<Asset>) => pb.collection('dm_asset').update(id, data),
  remove: (id: string) => pb.collection('dm_asset').delete(id),
};

export interface CatalogData {
  zones: Zone[];
  stations: Station[];
  customers: Customer[];
  points: Point[];
  assets: Asset[];
}

/** Nạp cả 5 bảng song song — dùng cho cả sơ đồ cây lẫn màn nhập liệu. */
export async function loadCatalog(): Promise<CatalogData> {
  const [z, s, c, p, a] = await Promise.all([
    zones.list(), stations.list(), customers.list(), points.list(), assets.list(),
  ]);
  return { zones: z, stations: s, customers: c, points: p, assets: a };
}

/**
 * Thông điệp lỗi đọc được từ lỗi PocketBase.
 * PB trả 400 kèm `data.<field>.message` khi vi phạm ràng buộc (vd trùng mã) —
 * lấy đúng thông điệp đó thay vì hiện "Something went wrong".
 */
export function pbErrorMessage(err: unknown): string {
  const e = err as { response?: { data?: Record<string, { message?: string }>; message?: string }; message?: string };
  const fields = e?.response?.data;
  if (fields) {
    const parts = Object.entries(fields)
      .map(([k, v]) => (v?.message ? `${k}: ${v.message}` : ''))
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  return e?.response?.message || e?.message || 'Lỗi không xác định';
}
