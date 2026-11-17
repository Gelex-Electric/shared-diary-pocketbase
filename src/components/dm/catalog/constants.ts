/**
 * Hằng dùng chung của màn Danh mục (`CatalogEntry` + các tab trong `catalog/`).
 * Tách ngày 17/11/2026 (đợt 5) — NGUYÊN VĂN, chỉ thêm `export`.
 */
import {
  Building2, Cable, Factory, Users, Gauge, Package, PackageCheck,
  History,
} from 'lucide-react';
import type { TabItem } from '../../ui/Tabs';
import type {
  VoltageLevel,
} from '../../../lib/dm/types';

/**
 * `lifecycle` là tab TRA CỨU, không phải bảng khai báo: nó nhúng nguyên màn
 * "Vòng đời vật tư" vào cuối dãy tab (user chốt 25/08/2026) thay vì đứng riêng
 * ngoài menu — người dùng khai điểm đo xong là đối chiếu ngay tại chỗ.
 */
export type CatTab = 'zone' | 'line' | 'station' | 'customer' | 'point' | 'stock' | 'supply' | 'lifecycle';

export const TABS: TabItem<CatTab>[] = [
  { id: 'zone', label: 'Khu công nghiệp', icon: Building2, sub: 'dm_zone' },
  { id: 'line', label: 'Lộ đường dây', icon: Cable, sub: 'dm_line' },
  { id: 'station', label: 'Trạm', icon: Factory, sub: 'dm_station' },
  { id: 'customer', label: 'Khách hàng', icon: Users, sub: 'dm_customer' },
  { id: 'point', label: 'Điểm đo', icon: Gauge, sub: 'dm_point' },
  { id: 'stock', label: 'Kho vật tư', icon: Package, sub: 'Thiết bị · vòng đời' },
  { id: 'supply', label: 'Gắn vật tư dự kiến', icon: PackageCheck, sub: 'Gắn số No vào nhu cầu' },
  { id: 'lifecycle', label: 'Rà soát', icon: History, sub: 'Đối chiếu hóa đơn' },
];

/** Tiêu đề + nút Thêm của từng tab KHAI BÁO; tab `lifecycle` không có (chỉ tra cứu). */
/** Gợi ý trong ô tìm kiếm — nói đúng cột nào tìm được, kẻo gõ mò. */
export const SEARCH_HINT: Record<Exclude<CatTab, 'lifecycle' | 'stock' | 'supply'>, string> = {
  zone: 'Tìm mã KCN, tên, địa chỉ...',
  line: 'Tìm mã lộ, tên lộ...',
  station: 'Tìm mã trạm, MKH, tên khách hàng...',
  customer: 'Tìm MKH, tên công ty, tên tắt, địa chỉ...',
  point: 'Tìm mã điểm đo, trạm, MKH, tên khách hàng...',
};

export const HEAD: Record<Exclude<CatTab, 'lifecycle' | 'stock' | 'supply'>, { title: string; desc: string; add: string }> = {
  zone: {
    title: 'Khu công nghiệp',
    desc: 'Gốc của cây đơn vị — khai trước trạm và điểm đo',
    add: 'Thêm KCN',
  },
  line: {
    title: 'Lộ đường dây',
    desc: 'Một KCN có nhiều lộ; một lộ không vắt sang KCN khác',
    add: 'Thêm lộ',
  },
  station: {
    title: 'Trạm',
    desc: 'Mỗi trạm thuộc đúng một KCN — một KCN có nhiều trạm',
    add: 'Thêm trạm',
  },
  customer: {
    title: 'Khách hàng',
    desc: 'Một khách hàng có nhiều điểm đo, có thể nằm ở nhiều trạm',
    add: 'Thêm khách hàng',
  },
  point: {
    title: 'Điểm đo',
    desc: 'Điểm đo phụ nằm trong phạm vi đo của một điểm đo chính',
    add: 'Thêm điểm đo',
  },
};

export const EMPTY_Z = { code: '', name: '', address: '' };
/*
  Mã lộ NHẬP TAY, không sinh tự động như mã trạm/điểm đo: mã lộ là tên ngoài
  đời do ngành điện đặt ("471-E27.1"), không suy ra được từ dữ liệu trong app.
*/
export const EMPTY_L = {
  code: '', name: '', zone: '', note: '', active: true,
  voltage_level: 'MV' as VoltageLevel,
};
/** `code` không có trong form trạm — hệ thống tự sinh từ 4 mảnh bên dưới. */
export const EMPTY_S = {
  line: '',
  zone: '', customer: '', ident: '',
  sdm_kva: '', p0_w: '', pk_w: '', note: '',
  /* Hai cờ tổn thất — xem `scripts/lib/lossParams.mjs`. Chỉ lưu CỜ, giá trị P0/Pk
     ước lượng được suy lại mỗi lần tính chứ không ghi vào `p0_w`/`pk_w`. */
  auto_loss_param: false, mv_metering: false,
};
export const EMPTY_C = { mkh: '', name: '', low_name: '', short_name: '', address: '', zone: '' };

/*
  Dòng vật tư (`AssetRow`) và các luật sửa bảng vật tư nằm ở `lib/dm/pointForm.ts`
  (tách 17/11/2026 để test được — `scripts/dm_test_point_form.ts`).
*/




/**
 * Khoảng giá trị thường gặp của thông số trạm — chỉ dùng để CẢNH BÁO khi nhập
 * lệch, không chặn lưu. Ngưỡng do user chốt 20/08/2026.
 * P0/Pk tính bằng W (không phải kW): MBA 180 kVA có Pk cỡ 1963 W.
 */
export const SDM_RANGE: [number, number] = [10, 10_000];
export const P0_RANGE: [number, number] = [50, 20_000];
export const PK_RANGE: [number, number] = [200, 100_000];

export const toNum = (s: string): number | undefined => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
};
export const str = (n?: number) => (n == null ? '' : String(n));

