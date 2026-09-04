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
  /** Do hệ thống sinh, không gõ tay — xem `buildStationCode` trong `naming.ts`. */
  code: string;
  zone: string;
  /** Chủ trạm — cần để lấy tên tắt khi sinh mã trạm. */
  customer?: string;
  /** Định danh trạm trong khuôn viên khách hàng: T1, T2, NX1… */
  ident?: string;
  sdm_kva?: number;
  /** Tổn hao không tải, đơn vị W (không phải kW). */
  p0_w?: number;
  /** Tổn hao ngắn mạch, đơn vị W. */
  pk_w?: number;
  note?: string;
}

export interface Customer extends PbRecord {
  mkh: string;
  name: string;
  /** Tên tắt: viết liền, không dấu, chỉ cho phép thêm dấu '-'. Dùng sinh mã trạm. */
  short_name?: string;
  address?: string;
  zone?: string;
  active?: boolean;
}

/**
 * Một lần CHUYỂN CHỦ THỂ của điểm đo: khách hàng đứng tên đổi, còn điểm đo vật
 * lý thì không (hợp nhất pháp nhân, chuyển nhượng nhà xưởng…).
 */
export interface OwnerTransfer {
  /** Mã khách hàng cũ. Rỗng nếu trước đó chưa gắn khách nào. */
  from?: string;
  /** Mã khách hàng mới. */
  to: string;
  /** Ngày chuyển, `YYYY-MM-DD`. */
  date: string;
  reason?: string;
}

export interface Point extends PbRecord {
  /** Mã điểm đo do hệ thống sinh — xem `buildPointCode` trong `naming.ts`. */
  code?: string;
  /** Định danh điểm đo, phần trong ngoặc cuối mã: `0,4` → `(0,4)`. */
  ident?: string;
  /**
   * Đoạn đuôi của điểm đo phụ (sau công suất): tên tắt KH phụ, hoặc nhãn mục
   * đích (CSCC, BCC…) khi trùng khách hàng với điểm đo chính.
   */
  sub_label?: string;
  /** Điểm đo phụ trỏ về điểm đo chính của nó. Rỗng nếu là điểm chính. */
  parent_point?: string;
  /** Mã bên HES — thường chưa có lúc khai, nên để tuỳ chọn. */
  line_id?: string;
  line_name?: string;
  station: string;
  zone?: string;
  customer?: string;
  role: PointRole;
  connection: Connection;
  hsn?: number;
  voltage_level?: VoltageLevel;
  status?: PointStatus;
  note?: string;

  /**
   * Lịch sử chuyển chủ thể. CÓ dữ liệu ở đây còn mang nghĩa MÃ ĐIỂM ĐO ĐÃ
   * ĐƯỢC GIỮ LẠI: mã nhúng tên tắt khách hàng nên đổi chủ sẽ làm mã tự đổi
   * theo, mà mã điểm đo chính là `LINE_NAME` bên HES.
   */
  owner_history?: OwnerTransfer[];
}

/** Loại vật tư gắn ở điểm đo. */
export type AssetType = 'CONGTO' | 'GP03' | 'TI' | 'TU' | 'SIM' | 'KHAC';

export type AssetStatus = 'dang_treo' | 'kho' | 'thao_go' | 'thanh_ly' | '';

/** Trạng thái của THIẾT BỊ (không phải của một lần lắp). */
export type DeviceStatus = 'kho' | 'dang_treo' | 'thanh_ly' | '';

/**
 * MỘT THIẾT BỊ VẬT LÝ — mỗi số chế tạo đúng một bản ghi (`serial` UNIQUE).
 *
 * Tách khỏi `Asset` vì vòng đời có đoạn NẰM KHO giữa hai lần lắp:
 *
 *   nhập kho → lắp ở A → tháo → nằm kho (rất lâu) → lắp ở B → tháo → thanh lý
 *
 * Trạng thái "đang nằm kho" không thuộc lần lắp nào, nên phải có chỗ đứng
 * riêng. Tỷ số TI và model cũng là thuộc tính của thiết bị chứ không phải của
 * lần lắp — trước đây bị chép lại ở mọi dòng nên sửa một chỗ là lệch chỗ khác.
 */
export interface Device extends PbRecord {
  /** Số No (số chế tạo) — định danh thật, UNIQUE ở tầng cơ sở dữ liệu. */
  serial: string;
  type: AssetType;
  ratio_primary?: number;
  ratio_secondary?: number;
  model_desc?: string;
  /**
   * Ngày thanh lý. Thứ DUY NHẤT không suy được từ dữ liệu — `kho` và
   * `dang_treo` luôn tính lại từ các lần lắp, nên không lưu cột `status`
   * nữa (đợt schema v14): cột lưu sẵn chắc chắn sẽ lệch với thực tế.
   */
  liquidated_at?: string;
  /**
   * Dành sẵn cho ĐIỂM ĐO nào — giữ chỗ là THUỘC TÍNH của thiết bị, không phải
   * một lần lắp chưa xảy ra.
   */
  hold_point?: string;
  /** Dành sẵn cho khách hàng ĐÃ có trong danh mục. */
  hold_for_customer?: string;
  /** Dành sẵn cho khách CHƯA có tên — gõ tự do. */
  hold_for_note?: string;
  /** KCN dự định dùng. */
  hold_zone?: string;
  /** Ngày nhập kho. */
  date_in?: string;
  /** Mã lô nhập — nhập một lần vài chục cái thì lọc lại theo lô. */
  batch?: string;
  note?: string;
}

export const DEVICE_STATUS_LABEL: Record<Exclude<DeviceStatus, ''>, string> = {
  kho: 'Trong kho',
  dang_treo: 'Đang treo',
  thanh_ly: 'Đã thanh lý',
};

export interface Asset extends PbRecord {
  /** Số No (số chế tạo) — định danh duy nhất của vật tư. */
  serial: string;
  type: AssetType;
  /** Thiết bị vật lý tương ứng — xem `Device`. */
  device?: string;
  /** Điểm đo đang lắp; rỗng = chưa gắn ở đâu. */
  point?: string;
  ratio_primary?: number;
  ratio_secondary?: number;
  model_desc?: string;
  status?: AssetStatus;
  /** Ngày treo lên điểm đo, dạng `YYYY-MM-DD` (PB lưu ISO, UI chỉ dùng phần ngày). */
  date_on?: string;
  /** Ngày tháo khỏi điểm đo. Còn treo thì để trống. */
  date_off?: string;
  /**
   * Có đang hoạt động tại điểm đo hay không.
   * Tách khỏi `status`: `status` là vòng đời trong KHO (đang treo/kho/tháo gỡ/
   * thanh lý), `active` là "cái này có đang đo ở điểm đo này không". Thay công
   * tơ thì cái cũ `active = false` nhưng vẫn giữ nguyên lịch sử ở điểm đo.
   */
  active?: boolean;
  note?: string;
}

export const ASSET_LABEL: Record<AssetType, string> = {
  CONGTO: 'Công tơ',
  GP03: 'Đo xa GP-03',
  TI: 'TI (biến dòng)',
  TU: 'TU (biến điện áp)',
  SIM: 'SIM',
  KHAC: 'Khác',
};

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
