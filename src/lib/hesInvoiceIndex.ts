/**
 * Chỉ số công tơ theo KỲ HÓA ĐƠN, đọc từ collection `invoice` trên PocketBase.
 *
 * Vì sao dùng nguồn này (user chốt 16/09/2026): chỉ số đầu/cuối kỳ ở đây là số
 * liệu CÓ GIÁ TRỊ PHÁP LÝ — màn "Biên bản xác nhận chỉ số" ghi vào đó và còn dò
 * đúng mốc 30 phút bên HES khớp với chỉ số chốt. File CSV của pipeline chỉ là
 * số liệu thô máy lấy hằng đêm.
 *
 * Một hóa đơn có thể tách thành NHIỀU bản ghi khi đổi giá giữa kỳ. Gộp lại theo
 * đúng luật của màn Biên bản: đầu kỳ lấy của khoảng sớm nhất, cuối kỳ lấy của
 * khoảng muộn nhất — giá không ảnh hưởng tới chỉ số.
 */
import { pb } from './pocketbase';
import { num } from './invoices';

/**
 * Các thành phần hiện trên bảng. `invoice` có sẵn cả `VC` (vô công); user chốt
 * 16/09/2026 tab này không cần, nên để ngoài. Muốn bật lại: thêm
 * `{ key: 'VC', label: 'Vô công', unit: 'kVarh' }` vào mảng, không phải sửa gì khác.
 */
export const INVOICE_COMPONENTS = [
  { key: 'BT', label: 'Biểu 1', unit: 'kWh' },
  { key: 'CD', label: 'Biểu 2', unit: 'kWh' },
  { key: 'TD', label: 'Biểu 3', unit: 'kWh' },
] as const;

export type InvoiceComponentKey = typeof INVOICE_COMPONENTS[number]['key'];

export interface InvoiceIndexRow {
  /** Số công tơ. */
  sct: string;
  mkh: string;
  customer: string;
  hsn: number;
  /** Ngày đầu/cuối kỳ, dạng "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  /** Chỉ số thô đầu/cuối kỳ từng thành phần (CHƯA nhân HSN). */
  index: Record<string, { dau: number | null; cuoi: number | null }>;
  /** Sản lượng đã nhân HSN, làm tròn. */
  values: Record<string, number | null>;
  /** Tổng tác dụng = BT + CĐ + TĐ. */
  total: number | null;
  /** Gộp từ ≥2 khoảng đổi giá hay không — để màn hình đánh dấu. */
  merged: boolean;
}

const dateOnly = (s?: string) => (s || '').split('T')[0].split(' ')[0];
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Khoá gộp của một kỳ hóa đơn, theo đúng thứ tự ưu tiên của màn Biên bản:
 * `BillId` (mã hóa đơn) → `IndexId` → nối theo công tơ + ngày đầu kỳ.
 */
function billKeyOf(r: any): string {
  const sct = String(r.SCT ?? '').trim();
  const bill = String(r.BillId ?? '').trim();
  if (bill) return `${sct}|B:${bill}`;
  const idx = String(r.IndexId ?? '').trim();
  if (idx) return `${sct}|I:${idx}`;
  return `${sct}|D:${dateOnly(r.StartDate)}`;
}

/** Gộp các khoảng đổi giá của cùng một kỳ thành một dòng chỉ số liên tục. */
export function mergeInvoiceRows(recs: any[]): InvoiceIndexRow {
  const byStart = [...recs].sort((a, b) =>
    dateOnly(a.StartDate).localeCompare(dateOnly(b.StartDate))
    || dateOnly(a.EndDate).localeCompare(dateOnly(b.EndDate)));
  const first = byStart[0];
  const last = byStart[byStart.length - 1];
  const hsn = num(last.HSN) || 1;

  const index: InvoiceIndexRow['index'] = {};
  const values: InvoiceIndexRow['values'] = {};
  let total: number | null = 0;
  for (const c of INVOICE_COMPONENTS) {
    const dau = first[`${c.key}_dau`] == null ? null : num(first[`${c.key}_dau`]);
    const cuoi = last[`${c.key}_cuoi`] == null ? null : num(last[`${c.key}_cuoi`]);
    index[c.key] = { dau, cuoi };
    const v = dau === null || cuoi === null ? null : Math.round((cuoi - dau) * hsn);
    values[c.key] = v;
    if (v === null) total = null; else if (total !== null) total += v;
  }

  return {
    sct: String(last.SCT ?? '').trim(),
    mkh: String(last.MKHang ?? '').trim(),
    customer: String(last.NMua ?? '').trim(),
    hsn,
    startDate: dateOnly(first.StartDate),
    endDate: dateOnly(last.EndDate),
    index, values, total,
    merged: recs.length > 1,
  };
}

/**
 * Chỉ số của mọi công tơ có hóa đơn CHỐT trong tháng `ym` ("YYYY-MM").
 *
 * Cận trên là đầu tháng kế tiếp chứ không phải ngày cuối tháng: PocketBase lưu
 * ngày dạng chuỗi "YYYY-MM-DD 00:00:00.000Z" nên so `<=` ngày cuối tháng sẽ bỏ
 * sót chính những hóa đơn chốt đúng ngày đó (bài học từ màn Biên bản).
 *
 * Bỏ hóa đơn phản kháng (`LoaiHD = "VC"`) — đó là hóa đơn tiền, không phải kỳ
 * chỉ số, gộp vào sẽ đếm đôi công tơ.
 */
export async function fetchInvoiceIndexMonth(ym: string): Promise<InvoiceIndexRow[]> {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return [];
  const start = `${ym}-01`;
  const nextStart = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;

  const list = await pb.collection('invoice').getFullList({
    filter: pb.filter('EndDate >= {:start} && EndDate < {:nextStart} && LoaiHD != "VC"',
      { start, nextStart }),
    sort: '-EndDate',
    requestKey: null,
  });

  const groups = new Map<string, any[]>();
  for (const r of list) {
    if (!String((r as any).SCT ?? '').trim()) continue;   // bản ghi không gắn công tơ
    const k = billKeyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return [...groups.values()]
    .map(mergeInvoiceRows)
    .sort((a, b) => a.sct.localeCompare(b.sct, 'vi', { numeric: true }));
}

/** Tháng gần nhất có hóa đơn, để mở màn hình ra là có số ngay. */
export async function latestInvoiceMonth(): Promise<string> {
  try {
    const r = await pb.collection('invoice').getList(1, 1, {
      filter: 'LoaiHD != "VC"', sort: '-EndDate', fields: 'EndDate', requestKey: null,
    });
    return dateOnly((r.items[0] as any)?.EndDate).slice(0, 7);
  } catch {
    return '';
  }
}
