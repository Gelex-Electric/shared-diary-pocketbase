/**
 * Tầng đọc collection `invoice` cho module danh mục `dm_*`.
 *
 * ⚠️ CHỈ ĐỌC. `invoice` là 1 trong 9 collection nghiệp vụ có sẵn (2110 bản ghi
 * dữ liệu thật, dùng chung giữa staging và production). Module này KHÔNG có
 * create / update / delete và không được thêm — mọi nhu cầu ghi phải đi chỗ khác.
 *
 * Vì sao tách khỏi `repo.ts`: `repo.ts` là tầng của riêng nhóm `dm_*` và có đủ
 * 4 thao tác; trộn một collection chỉ-đọc vào đó dễ khiến người sau tưởng cũng
 * ghi được.
 */
import { pb } from '../pocketbase';
import type { InvoiceLite } from './lifecycle';
import type { CustomerFact } from './customerSync';

/** Chỉ lấy đúng các cột cần cho vòng đời + HSN. 2110 bản ghi × 7 cột ≈ 200KB. */
const FIELDS = 'SCT,MKHang,HSN,StartDate,EndDate,ThTien,LoaiHD';

/** Escape dấu nháy kép cho filter PocketBase — số công tơ do người dùng gõ vào. */
const q = (v: string) => v.replace(/"/g, '\\"');

/**
 * Hóa đơn của MỘT số công tơ. Dùng trong form điểm đo: lọc phía máy chủ, không
 * kéo cả kho hóa đơn về máy người dùng.
 */
export async function invoicesOfSerial(serial: string): Promise<InvoiceLite[]> {
  const s = serial.trim();
  if (!s) return [];
  const items = await pb.collection('invoice').getFullList({
    filter: `SCT="${q(s)}"`,
    fields: FIELDS,
    sort: 'StartDate',
    batch: 500,
  });
  return items as unknown as InvoiceLite[];
}

/**
 * Dữ liệu khách hàng lấy từ hóa đơn, để đồng bộ danh mục khách hàng.
 * Cột riêng, không dùng `FIELDS` — địa chỉ là chuỗi dài, chỉ kéo về khi cần.
 */
export async function loadCustomerFacts(): Promise<CustomerFact[]> {
  const items = await pb.collection('invoice').getFullList({
    fields: 'MKHang,NMua,DChiNMua,EndDate',
    sort: 'EndDate',
    batch: 500,
  });
  return items as unknown as CustomerFact[];
}

/**
 * Toàn bộ hóa đơn (dạng gọn). CHỈ dùng cho màn "Vòng đời vật tư" và cho việc
 * đồng bộ khách hàng — hai chỗ buộc phải quét hết. Đừng gọi trong form nhập liệu.
 */
export async function loadAllInvoicesLite(): Promise<InvoiceLite[]> {
  const items = await pb.collection('invoice').getFullList({
    fields: FIELDS,
    sort: 'StartDate',
    batch: 500,
  });
  return items as unknown as InvoiceLite[];
}
