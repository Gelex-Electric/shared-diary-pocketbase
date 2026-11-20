/**
 * Xóa dữ liệu hóa đơn nạp từ XML — dùng chung cho màn Biên bản (xóa từng công tơ) và Công nợ
 * (xóa cả hóa đơn của một kỳ, user chốt 20/11/2026). Hai collection nối bằng `BillId`:
 * `invoice` (dòng chi tiết công tơ × khoảng giá) và `einvoice` (một bản ghi = một hóa đơn).
 * Luật: hóa đơn không còn dòng `invoice` nào ⇒ xóa luôn `einvoice` (user chốt 01/10/2026),
 * để nạp lại XML không vướng bản cũ.
 */
import { pb } from './pocketbase';

const hasBill = (billId?: string | number | null) => {
  const b = (billId ?? '').toString().trim();
  return b && b !== '0' ? b : '';
};

/** Xóa `einvoice` của BillId nếu không còn dòng `invoice` nào. Trả về true nếu đã xóa. */
export async function removeEinvoiceIfOrphan(billId?: string | number | null): Promise<boolean> {
  const b = hasBill(billId);
  if (!b) return false;
  const left = await pb.collection('invoice').getList(1, 1, {
    filter: pb.filter('BillId = {:b}', { b }), fields: 'id', requestKey: null,
  });
  if (left.totalItems > 0) return false;
  const einv = await pb.collection('einvoice').getList(1, 1, {
    filter: pb.filter('BillId = {:b}', { b }), fields: 'id', requestKey: null,
  });
  if (!einv.items[0]) return false;
  await pb.collection('einvoice').delete(einv.items[0].id);
  return true;
}

/** Xóa các dòng `invoice` theo id, rồi dọn `einvoice` nếu hóa đơn hết dòng. */
export async function deleteInvoiceRows(ids: string[], billId?: string | number | null) {
  await Promise.all(ids.map(id => pb.collection('invoice').delete(id)));
  return { einvRemoved: await removeEinvoiceIfOrphan(billId) };
}

/**
 * Xóa CẢ hóa đơn: mọi dòng `invoice` cùng BillId (kể cả dòng ngoài tháng đang xem) + `einvoice`.
 * Dữ liệu cũ không có BillId ⇒ chỉ xóa đúng các id truyền vào.
 */
export async function deleteWholeBill(billId: string | number | null | undefined, fallbackIds: string[]) {
  const b = hasBill(billId);
  const ids = b
    ? (await pb.collection('invoice').getFullList<{ id: string }>({
        filter: pb.filter('BillId = {:b}', { b }), fields: 'id', requestKey: null,
      })).map(r => r.id)
    : fallbackIds;
  const { einvRemoved } = await deleteInvoiceRows(ids, b);
  return { rows: ids.length, einvRemoved };
}
