/**
 * Tên khách hàng dùng trong THÔNG BÁO NGỪNG CẤP ĐIỆN.
 *
 * Nguồn tên của màn thông báo là `metterinfo.csv`, nơi `CUSTOMER_NAME` viết HOA
 * toàn bộ ("CÔNG TY TNHH RICO VIỆT NAM") vì đó là dạng bên HES xuất ra. In lên
 * văn bản gửi khách thì phải là dạng đọc được — đúng thứ đã soạn sẵn ở cột
 * `dm_customer.low_name` (danh từ riêng giữ hoa, phần còn lại viết thường).
 *
 * Khoá nối hai nguồn: `metterinfo.CUSTOMER_CODE` == `dm_customer.mkh`, cùng dạng
 * `KCNTH-001`.
 *
 * KHÔNG có `low_name` cho mã đó thì GIỮ NGUYÊN tên CSV. Thông báo ngừng điện là
 * văn bản gửi ra ngoài: thà in tên viết hoa còn hơn in tên rỗng hoặc tên đoán.
 */
import { customers } from './dm/repo';
import type { OutageCustomer } from '../types';

/** `mkh` → `low_name`. Chỉ nhận mã có `low_name` không rỗng. */
export type LowNameMap = Map<string, string>;

export async function loadLowNameMap(): Promise<LowNameMap> {
  const rows = await customers.list();
  const map: LowNameMap = new Map();
  for (const c of rows) {
    const low = (c.low_name ?? '').trim();
    if (c.mkh && low) map.set(c.mkh, low);
  }
  return map;
}

/**
 * Đổi tên một khách sang bản viết thường nếu tra được.
 *
 * Khách nhập tay (id `manual-…`) không có mã thật nên tra không ra — giữ đúng
 * những gì người dùng đã gõ.
 */
export const withLowName = (c: OutageCustomer, map: LowNameMap): OutageCustomer => {
  const low = map.get(c.MKH);
  return low ? { ...c, Name: low } : c;
};

export const withLowNames = (list: OutageCustomer[], map: LowNameMap): OutageCustomer[] =>
  list.map(c => withLowName(c, map));
