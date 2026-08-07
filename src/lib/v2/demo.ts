/**
 * Dữ liệu MẪU để xem thử giao diện khi collection `v2_*` chưa tạo trên
 * PocketBase production.
 *
 * Cố ý dựng đủ các ca mà luật phải xử lý, để nhìn màn hình là thấy luật chạy:
 * điểm đo đúng chuẩn, điểm đo lắp dở, và ba kiểu lắp sai khác nhau. Số liệu là
 * bịa, tên trạm đặt theo mã KCN thật cho dễ hình dung.
 *
 * Màn hình LUÔN hiện băng cảnh báo khi đang dùng bộ này — không được để người
 * dùng nhầm dữ liệu mẫu là dữ liệu thật.
 */
import type { V2Asset, V2AssetType, V2Install, V2Point } from './schema';

const P = (
  code: string, name: string, zone_code: string, station_code: string,
  point_status: V2Point['point_status'],
): V2Point => ({ id: code, code, name, zone_code, station_code, point_status });

export const DEMO_POINTS: V2Point[] = [
  P('YM.TITAN.NX9.01', 'Titan - nhà xưởng 9', 'KCNYM', 'YM.TITAN.NX9', 'active'),
  P('YM.TITAN.NX9.02', 'Titan - trạm bơm', 'KCNYM', 'YM.TITAN.NX9', 'active'),
  P('YM.HOALINH.01', 'Hoa Linh - dây chuyền 1', 'KCNYM', 'YM.HOALINH', 'active'),
  P('TH.VIETTHANH.01', 'Việt Thành - xưởng A', 'KCNTH', 'TH.VIETTHANH', 'active'),
  P('TH.VIETTHANH.02', 'Việt Thành - xưởng B', 'KCNTH', 'TH.VIETTHANH', 'active'),
  P('PD.MINHKHAI.01', 'Minh Khai - trạm chính', 'KCNPD', 'PD.MINHKHAI', 'active'),
  P('03.DAILOI.01', 'Đại Lợi - mở rộng', 'KCN03', '03.DAILOI', 'chua_van_hanh'),
  P('03.DAILOI.02', 'Đại Lợi - kho lạnh', 'KCN03', '03.DAILOI', 'du_kien'),
  P('YM.CUKIM.01', 'Cũ Kim - đã trả điểm', 'KCNYM', 'YM.CUKIM', 'dismounted'),
];

let n = 0;
const A = (
  type: V2AssetType, serial: string, o: Partial<V2Asset> = {},
): V2Asset => {
  n++;
  const ratio = o.ratio_primary && o.ratio_secondary
    ? o.ratio_primary / o.ratio_secondary : undefined;
  return {
    id: `demo-${n}`, serial, type,
    current_status: o.current_point ? 'dang_treo' : 'kho',
    next_calibration: '2028-06-30',
    ...o, ratio,
  };
};

const ti = (serial: string, p: number, s: number, point?: string, cal = '2028-06-30') =>
  A('TI', serial, { ratio_primary: p, ratio_secondary: s, current_point: point, next_calibration: cal });

export const DEMO_ASSETS: V2Asset[] = [
  // 1. Chuẩn — công tơ trực tiếp, HSN = 1
  A('ME42', '21ME42-0011', { current_point: 'YM.TITAN.NX9.01' }),
  A('GP03', 'GP03-A0011', { current_point: 'YM.TITAN.NX9.01' }),

  // 2. Chuẩn — công tơ gián tiếp + bộ 3 TI cùng tỷ số, HSN = 500
  A('ME41', '20ME41-0042', { current_point: 'YM.TITAN.NX9.02' }),
  A('GP03', 'GP03-A0042', { current_point: 'YM.TITAN.NX9.02' }),
  ti('TI-2500-01', 2500, 5, 'YM.TITAN.NX9.02'),
  ti('TI-2500-02', 2500, 5, 'YM.TITAN.NX9.02'),
  ti('TI-2500-03', 2500, 5, 'YM.TITAN.NX9.02'),

  // 3. Chuẩn — trung thế, có TU: 22000/100 × 2500/5 = 110000
  A('ME41', '20ME41-0077', { current_point: 'YM.HOALINH.01' }),
  A('GP03', 'GP03-A0077', { current_point: 'YM.HOALINH.01' }),
  ti('TI-2500-11', 2500, 5, 'YM.HOALINH.01'),
  ti('TI-2500-12', 2500, 5, 'YM.HOALINH.01'),
  ti('TI-2500-13', 2500, 5, 'YM.HOALINH.01'),
  A('TU', 'TU-22K-01', { ratio_primary: 22000, ratio_secondary: 100, current_point: 'YM.HOALINH.01' }),

  // 4. Lắp dở — ME-41 chưa có TI (mức "thiếu", không khoá ghi)
  A('ME41', '20ME41-0103', { current_point: 'TH.VIETTHANH.01' }),
  A('GP03', 'GP03-A0103', { current_point: 'TH.VIETTHANH.01' }),

  // 5. SAI R3 — công tơ trực tiếp mà treo TI
  A('ME42', '21ME42-0120', { current_point: 'TH.VIETTHANH.02' }),
  A('GP03', 'GP03-A0120', { current_point: 'TH.VIETTHANH.02' }),
  ti('TI-1000-05', 1000, 5, 'TH.VIETTHANH.02'),

  // 6. SAI R5 + R7 — TI lẫn tỷ số, lại còn một cái quá hạn kiểm định
  A('ME41', '20ME41-0155', { current_point: 'PD.MINHKHAI.01' }),
  A('GP03', 'GP03-A0155', { current_point: 'PD.MINHKHAI.01' }),
  ti('TI-1500-07', 1500, 5, 'PD.MINHKHAI.01'),
  ti('TI-2000-08', 2000, 5, 'PD.MINHKHAI.01', '2024-03-31'),

  // 7. Điểm đo chưa vận hành, mới có mỗi GP-03
  A('GP03', 'GP03-A0200', { current_point: '03.DAILOI.01' }),

  // Tồn kho
  A('ME41', '20ME41-0301'),
  A('ME42', '21ME42-0302'),
  A('ME42', '21ME42-0303', { current_status: 'dat', calibration_date: '2026-05-12', next_calibration: '2029-05-12' }),
  A('GP03', 'GP03-A0304'),
  A('GP03', 'GP03-A0305'),
  ti('TI-2500-21', 2500, 5),
  ti('TI-2500-22', 2500, 5),
  ti('TI-2500-23', 2500, 5),
  ti('TI-800-24', 800, 5, undefined, '2025-12-31'),
  A('TI', 'TI-CHUA-KHAI-25'),
  A('ME41', '20ME41-0399', { current_status: 'dang_kiem_dinh' }),
  A('ME41', '19ME41-0400', { current_status: 'khong_dat', next_calibration: '2025-01-31' }),
];

/** Suy `v2_install` từ `current_point` của dữ liệu mẫu — khỏi khai hai lần. */
export const DEMO_INSTALLS: V2Install[] = DEMO_ASSETS
  .filter(a => a.current_point)
  .map((a, i) => ({
    id: `di-${i}`, asset: a.id, point: a.current_point as string,
    from_date: '2026-01-15', is_current: true,
  }));
