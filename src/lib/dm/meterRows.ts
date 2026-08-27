/**
 * Chuyển danh mục `dm_*` (PocketBase) thành các dòng "khách hàng ↔ công tơ" mà
 * màn "Thông tin khách hàng & Công tơ" đang dùng.
 *
 * Vì sao có file này (user chốt 25/08/2026): màn đó vốn đọc `public/metterinfo.csv`
 * — bản kết xuất từ HES, chạy theo pipeline nên trễ một ngày và KHÔNG biết những
 * gì vừa khai trong Danh mục. Danh mục mới là nơi người dùng khai và sửa, nên
 * phải lấy theo đó.
 *
 * Giữ nguyên hình dạng `MeterInfoRow` của bản CSV để phần giao diện không phải
 * viết lại — chỉ đổi NGUỒN, không đổi cách bày.
 *
 * Module THUẦN: không gọi mạng, nhận sẵn `CatalogData`.
 */
import type { MeterInfoRow } from '../meterInfo';
import type { CatalogData } from './repo';

/** Một khách hàng kèm toàn bộ công tơ của họ. */
export interface CustomerMeters {
  /** Mã khách hàng (`dm_customer.mkh`). */
  code: string;
  name: string;
  /** Tên KCN — khớp `AREAS`, để lọc và tô màu như cũ. */
  area: string;
  meters: MeterInfoRow[];
}

/**
 * Gom theo khách hàng. Khách chưa có công tơ nào VẪN xuất hiện (danh sách rỗng)
 * — bản CSV chỉ liệt kê khách đã có công tơ bên HES, nên khách vừa khai hoặc
 * chuẩn bị mua điện thì biến mất khỏi màn hình, đúng thứ người dùng cần thấy
 * nhất lại không thấy.
 */
export function customerMetersOf(d: CatalogData): CustomerMeters[] {
  const zoneName = new Map(d.zones.map(z => [z.id, z.name]));
  const zoneCode = new Map(d.zones.map(z => [z.id, z.code]));
  const stationById = new Map(d.stations.map(s => [s.id, s]));
  const customerById = new Map(d.customers.map(c => [c.id, c]));

  const out = new Map<string, CustomerMeters>();
  for (const c of d.customers) {
    out.set(c.id, {
      code: c.mkh,
      name: c.name,
      area: (c.zone && zoneName.get(c.zone)) || '',
      meters: [],
    });
  }

  for (const a of d.assets) {
    // `!a.point` = vật tư dự kiến đang nằm kho, chưa lắp cho ai.
    if (a.type !== 'CONGTO' || !a.point) continue;
    const point = d.points.find(p => p.id === a.point);
    if (!point) continue;
    const station = point.station ? stationById.get(point.station) : undefined;
    // KCN lấy theo TRẠM chứ không theo khách hàng: khách thuê nhà xưởng có thể
    // được khai ở KCN khác với nơi đặt công tơ.
    const zid = station?.zone;
    const group = point.customer ? out.get(point.customer) : undefined;
    if (!group) continue;

    const customer = point.customer ? customerById.get(point.customer) : undefined;
    group.meters.push({
      METER_NO: a.serial,
      // Cột "Hệ số nhân" bên CSV nằm ở METER_NAME — giữ đúng chỗ đó.
      METER_NAME: point.hsn != null ? String(point.hsn) : '',
      METER_MODEL_DESC: a.model_desc ?? '',
      CUSTOMER_CODE: customer?.mkh ?? '',
      CUSTOMER_NAME: customer?.name ?? '',
      ADDRESS: (zid && zoneName.get(zid)) || group.area,
      LINE_NAME: station?.code ?? '',
      LINE_ID: point.line_id ?? '',
      CODE: (zid && zoneCode.get(zid)) || '',
      ROLE: point.role,
      STATUS: a.active ? 'Yes' : 'No',
    });
  }

  for (const g of out.values()) {
    g.meters.sort((x, y) => x.METER_NO.localeCompare(y.METER_NO, 'vi', { numeric: true }));
  }
  return [...out.values()].sort((a, b) => a.code.localeCompare(b.code, 'vi', { numeric: true }));
}
