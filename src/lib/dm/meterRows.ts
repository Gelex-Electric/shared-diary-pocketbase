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

/**
 * Danh sách CÔNG TƠ ĐANG TREO, phẳng — dùng cho hai màn "Lấy chỉ số từ HES"
 * (user chốt 04/09/2026: đổi nguồn từ `metterinfo.csv` sang PocketBase).
 *
 * Vì sao đổi: `metterinfo.csv` là bản kết xuất từ HES do pipeline chạy hằng
 * đêm, nên (a) trễ một ngày, (b) không biết gì về những gì vừa khai trong Danh
 * mục, và (c) là nguồn thứ hai chạy song song với `dm_*` — đối chiếu ngày
 * 04/09 đã lộ ra hai công tơ lệch HSN giữa hai nguồn.
 *
 * `hes_index_daily.csv` thì GIỮ NGUYÊN: đó là chỉ số đo đếm do pipeline chốt
 * mỗi ngày, không phải danh mục, và không có nguồn nào khác thay được.
 *
 * "Đang treo" ở đây là CÓ ngày treo và CHƯA có ngày tháo — chặt hơn cờ `active`,
 * vì vật tư dự kiến cũng mang `active = true` mà chưa hề ra hiện trường.
 */
export function hesMeterRowsOf(d: CatalogData): MeterInfoRow[] {
  const zoneName = new Map(d.zones.map(z => [z.id, z.name]));
  const zoneCode = new Map(d.zones.map(z => [z.id, z.code]));
  const stationById = new Map(d.stations.map(s => [s.id, s]));
  const customerById = new Map(d.customers.map(c => [c.id, c]));
  const pointById = new Map(d.points.map(p => [p.id, p]));
  const ymd = (v?: string) => (v ?? '').slice(0, 10);

  const rows: MeterInfoRow[] = [];
  for (const a of d.assets) {
    if (a.type !== 'CONGTO' || !a.point) continue;
    if (!ymd(a.date_on) || ymd(a.date_off)) continue;
    const point = pointById.get(a.point);
    if (!point) continue;
    const station = point.station ? stationById.get(point.station) : undefined;
    // KCN lấy theo TRẠM — khách thuê nhà xưởng có thể khai ở KCN khác.
    const zid = station?.zone;
    const customer = point.customer ? customerById.get(point.customer) : undefined;

    rows.push({
      METER_NO: (a.serial ?? '').trim(),
      // Cột "Hệ số nhân" bên CSV nằm ở METER_NAME — giữ đúng chỗ đó.
      METER_NAME: point.hsn != null ? String(point.hsn) : '',
      METER_MODEL_DESC: a.model_desc ?? '',
      CUSTOMER_CODE: customer?.mkh ?? '',
      CUSTOMER_NAME: customer?.name ?? '',
      ADDRESS: (zid && zoneName.get(zid)) || '',
      /*
        MÃ ĐIỂM ĐO chính là `LINE_NAME` bên HES, nên ưu tiên nó rồi mới tới mã
        trạm. Cột này vừa để hiển thị vừa để sắp xếp, lấy mã trạm thì mọi điểm
        đo của cùng một trạm trông giống hệt nhau.
      */
      LINE_NAME: point.code || point.line_name || station?.code || '',
      LINE_ID: point.line_id ?? '',
      CODE: (zid && zoneCode.get(zid)) || '',
      ROLE: point.role,
      // Đã lọc ở trên nên tới đây luôn là đang treo.
      STATUS: 'Yes',
    });
  }
  return rows.sort((a, b) =>
    (a.LINE_NAME + a.METER_NO).localeCompare(b.LINE_NAME + b.METER_NO, 'vi', { numeric: true }));
}
