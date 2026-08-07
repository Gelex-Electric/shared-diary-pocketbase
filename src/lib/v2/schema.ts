/**
 * Khai báo dữ liệu của module vật tư làm lại (v2).
 *
 * Tên collection đều mang tiền tố `v2_` và là các collection MỚI trên
 * PocketBase production. KHÔNG đụng tới `dm_*` / `vt_*` của app cũ (user chốt
 * 07/08) — hai bộ chạy song song cho tới khi user quyết bỏ bộ cũ.
 *
 * Đợt này chỉ làm ĐIỂM ĐO và VẬT TƯ. Vì vậy trạm/KCN tạm lưu dưới dạng mã chữ
 * trên chính điểm đo, chưa dựng bảng riêng — thêm bảng sau vẫn được, còn dựng
 * sẵn bảng rỗng thì chỉ tổ đoán mò cấu trúc khi chưa dùng tới.
 */

export const V2_COLLECTIONS = {
  point: 'v2_point',
  asset: 'v2_asset',
  install: 'v2_install',
  event: 'v2_event',
} as const;

/** Loại vật tư. Chuỗi lưu trong PocketBase đúng bằng các giá trị này. */
export type V2AssetType = 'ME41' | 'ME42' | 'DTS27' | 'TI' | 'TU' | 'GP03' | 'KHAC';

export const V2_ASSET_TYPES: V2AssetType[] = ['ME41', 'ME42', 'DTS27', 'TI', 'TU', 'GP03', 'KHAC'];

export const V2_ASSET_TYPE_LABEL: Record<V2AssetType, string> = {
  ME41: 'ME-41', ME42: 'ME-42', DTS27: 'DTS27',
  TI: 'TI', TU: 'TU', GP03: 'GP-03', KHAC: 'Khác',
};

/** Công tơ gián tiếp — đo qua TI nên BẮT BUỘC có TI (luật R4). */
export const METER_INDIRECT: V2AssetType[] = ['ME41'];

/**
 * Công tơ trực tiếp — đấu thẳng, HSN = 1, cấm treo TI/TU (luật R3).
 * DTS27 tạm xếp vào đây (giả định ghi trong plan, chờ user xác nhận).
 */
export const METER_DIRECT: V2AssetType[] = ['ME42', 'DTS27'];

export const METER_TYPES: V2AssetType[] = [...METER_INDIRECT, ...METER_DIRECT];

export const isMeter = (t: string): boolean => METER_TYPES.includes(t as V2AssetType);
export const isIndirectMeter = (t: string): boolean => METER_INDIRECT.includes(t as V2AssetType);
export const isDirectMeter = (t: string): boolean => METER_DIRECT.includes(t as V2AssetType);
/** Loại có tỷ số biến đổi, tham gia phép nhân HSN. */
export const hasRatio = (t: string): boolean => t === 'TI' || t === 'TU';

/** Trạng thái điểm đo. `du_kien` và `dismounted` được miễn luật đòi thiết bị. */
export type V2PointStatus = 'du_kien' | 'chua_van_hanh' | 'active' | 'dismounted';

export type V2AssetStatus =
  | 'kho' | 'dang_treo' | 'cho_kiem_dinh' | 'dang_kiem_dinh'
  | 'dat' | 'khong_dat' | 'thanh_ly';

export interface V2Point {
  id: string;
  code: string;
  name: string;
  zone_code: string;
  station_code: string;
  point_status: V2PointStatus;
  note?: string;
}

export interface V2Asset {
  id: string;
  serial: string;
  type: V2AssetType;
  /** Tỷ số sơ cấp / thứ cấp, chỉ có ở TI và TU. */
  ratio_primary?: number;
  ratio_secondary?: number;
  /** = ratio_primary / ratio_secondary, tính sẵn khi lưu. */
  ratio?: number;
  calibration_date?: string;
  next_calibration?: string;
  current_status: V2AssetStatus;
  current_point?: string;
  note?: string;
}

export interface V2Install {
  id: string;
  asset: string;
  point: string;
  from_date: string;
  to_date?: string;
  is_current: boolean;
}
