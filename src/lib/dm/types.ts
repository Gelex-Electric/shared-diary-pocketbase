/**
 * Kiểu dữ liệu cho 4 collection danh mục trên PocketBase (tạo 14/08/2026):
 *   dm_zone (KCN) 1─N dm_station (Trạm) 1─N dm_point (Điểm đo)
 *   dm_customer (Khách hàng) 1─N dm_point
 *
 * Vật tư (dm_asset) chưa thuộc bước này — xem plan
 * `plans/2026-08-14-quan-ly-tram-va-diem-do.md`.
 */

/** Điểm đo chính hay phụ (phụ = nằm trong phạm vi đo của điểm chính). */
export type PointRole = 'chinh' | 'phu';

/**
 * Đấu nối trực tiếp hay gián tiếp:
 * - `truc_tiep`  : công tơ đo thẳng, KHÔNG có TI, HSN = 1.
 * - `gian_tiep`  : qua biến dòng, phải đủ 3 TI, HSN suy từ tỷ số TI (×TU nếu có).
 */
export type Connection = 'truc_tiep' | 'gian_tiep';

export type VoltageLevel = 'LV' | 'MV' | '';

export type PointStatus = 'du_kien' | 'chua_van_hanh' | 'active' | 'thao_go' | '';

/** Bản ghi PocketBase nào cũng có 3 trường này. */
interface PbRecord {
  id: string;
  created?: string;
  updated?: string;
}

export interface Zone extends PbRecord {
  code: string;
  name: string;
  address?: string;
  active?: boolean;
}

export interface Station extends PbRecord {
  code: string;
  name?: string;
  zone: string;
  sdm_kva?: number;
  p0_kw?: number;
  pk_kw?: number;
  note?: string;
}

export interface Customer extends PbRecord {
  mkh: string;
  name: string;
  address?: string;
  zone?: string;
  active?: boolean;
}

export interface Point extends PbRecord {
  line_id: string;
  line_name: string;
  station: string;
  zone?: string;
  customer?: string;
  role: PointRole;
  connection: Connection;
  hsn?: number;
  voltage_level?: VoltageLevel;
  status?: PointStatus;
  note?: string;
}

/* ------------------------- nhãn hiển thị ------------------------- */

export const ROLE_LABEL: Record<PointRole, string> = {
  chinh: 'Chính',
  phu: 'Phụ',
};

export const CONNECTION_LABEL: Record<Connection, string> = {
  truc_tiep: 'Trực tiếp',
  gian_tiep: 'Gián tiếp',
};

export const STATUS_LABEL: Record<Exclude<PointStatus, ''>, string> = {
  du_kien: 'Dự kiến',
  chua_van_hanh: 'Chưa vận hành',
  active: 'Đang vận hành',
  thao_go: 'Đã tháo gỡ',
};

export const VOLTAGE_LABEL: Record<Exclude<VoltageLevel, ''>, string> = {
  LV: 'Hạ áp (LV)',
  MV: 'Trung áp (MV)',
};

/**
 * HSN mặc định theo kiểu đấu nối. Trực tiếp luôn = 1 (không có TI để nhân).
 * Gián tiếp trả `undefined` — phải nhập tay hoặc tính từ TI khi có bảng vật tư.
 */
export const defaultHsn = (c: Connection): number | undefined =>
  c === 'truc_tiep' ? 1 : undefined;
