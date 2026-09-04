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
import type { InvoiceUsage } from './subDeduct';
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
    // Tắt tự huỷ: form điểm đo tra nhiều số công tơ một lúc, cùng đường dẫn
    // `/collections/invoice/records` nên SDK sẽ huỷ hết chỉ giữ lần cuối.
    requestKey: null,
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
    // Tắt tự huỷ: form điểm đo tra nhiều số công tơ một lúc, cùng đường dẫn
    // `/collections/invoice/records` nên SDK sẽ huỷ hết chỉ giữ lần cuối.
    requestKey: null,
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
    // Tắt tự huỷ: form điểm đo tra nhiều số công tơ một lúc, cùng đường dẫn
    // `/collections/invoice/records` nên SDK sẽ huỷ hết chỉ giữ lần cuối.
    requestKey: null,
  });
  return items as unknown as InvoiceLite[];
}

/**
 * Hóa đơn của MỘT mã khách hàng. Dùng để đối chiếu NGƯỢC: khách này trong hóa
 * đơn đang ghi những số công tơ nào.
 *
 * Vì sao cần chiều ngược: `invoicesOfSerial` chỉ trả lời "số công tơ đang khai
 * có phải của khách này không" — gõ nhầm hẳn sang một số không tồn tại thì
 * không có hóa đơn nào, và câu hỏi đó trả lời "không biết". Hỏi từ phía khách
 * hàng thì nói được luôn hóa đơn đang dùng số nào, tức chỉ ra chỗ sai.
 */
export async function invoicesOfMkh(mkh: string): Promise<InvoiceLite[]> {
  const m = mkh.trim();
  if (!m) return [];
  const items = await pb.collection('invoice').getFullList({
    filter: `MKHang="${q(m)}"`,
    fields: FIELDS,
    sort: 'StartDate',
    batch: 500,
    requestKey: null,
  });
  return items as unknown as InvoiceLite[];
}

/**
 * Hóa đơn kèm CỘT SẢN LƯỢNG, chỉ lấy đúng các số công tơ cần và chỉ từ mốc
 * `sinceYmd` trở đi — dùng cho việc đối chiếu phụ trừ (`lib/dm/subDeduct.ts`).
 *
 * Không nhét mấy cột này vào `FIELDS` dùng chung: mọi chỗ khác chỉ cần ngày và
 * HSN, kéo thêm 6 cột số cho toàn bộ kho hóa đơn là phí băng thông của mọi màn.
 */
export async function invoicesUsageOf(serials: string[], sinceYmd: string): Promise<InvoiceUsage[]> {
  const list = [...new Set(serials.map(s => s.trim()).filter(Boolean))];
  if (!list.length) return [];

  /*
    LẤY TỪ ĐẦU THÁNG chứa `sinceYmd`, không phải từ đúng ngày đó.

    Phép đối chiếu gộp theo THÁNG CHỐT, nên cắt giữa tháng là so nửa tháng bên
    này với cả tháng bên kia. Đúng ca `TH.BQL.T2.160kVA` tháng 07/2026: mốc 40
    ngày rơi vào 26/07, làm rụng hóa đơn 01→19/07 của điểm đo chính (công tơ
    thay ngày 19/07) trong khi hóa đơn cả tháng của điểm phụ vẫn còn — báo lệch
    1840 kWh trong khi cộng đủ hai hóa đơn thì khớp tuyệt đối.
  */
  const from = `${sinceYmd.slice(0, 7)}-01`;

  // PocketBase không có toán tử IN, phải ghép OR. Chia lô cho chuỗi filter khỏi
  // dài quá mức URL chịu được.
  const out: InvoiceUsage[] = [];
  const CHUNK = 40;
  for (let i = 0; i < list.length; i += CHUNK) {
    const orSct = list.slice(i, i + CHUNK).map(s => `SCT="${q(s)}"`).join('||');
    const items = await pb.collection('invoice').getFullList({
      filter: `(${orSct}) && EndDate >= "${q(from)} 00:00:00.000Z"`,
      fields: 'SCT,StartDate,EndDate,LoaiHD,SL_BT,SL_CD,SL_TD,phu_BT,phu_CD,phu_TD',
      batch: 500,
      requestKey: null,
    });
    out.push(...(items as unknown as InvoiceUsage[]));
  }
  return out;
}
