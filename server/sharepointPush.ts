/**
 * Đẩy một hóa đơn điện tử sang Power Automate (flow "Dong bo HoaDon") để ghi vào list SharePoint.
 *
 * Gọi NGAY SAU KHI `POST /api/einvoice/:id/billval` lưu xong BILLVAL (server/einvoiceApi.ts) ⇒ lúc đó
 * đã tải được 2 PDF. Gói gửi đi gồm metadata + 3 file (giấy báo NOTI, hóa đơn BILLPDF, XML) dạng base64,
 * nên flow KHÔNG cần đăng nhập PocketBase (không giữ mật khẩu/token trong flow).
 *
 * Biến môi trường:
 *   FLOW_DONGBO_URL  URL trigger "When an HTTP request is received" (có chữ ký `sig` — coi như bí mật,
 *                    chỉ đặt ở Railway, KHÔNG ghi vào repo/log). Không đặt ⇒ không đẩy (localhost, staging).
 *
 * Chạy NỀN, nối tiếp từng hóa đơn (nạp 50 XML không bắn 100 request CCIS cùng lúc); lỗi chỉ ghi log,
 * không làm hỏng việc lấy BILLVAL. Flow nên upsert theo `BillId` (unique) vì nạp lại cũng đẩy lại.
 */
import { fetchCcisPdf } from './ccis';

/** Trường metadata đọc kèm khi lấy BILLVAL — cũng là các trường gửi sang flow (trừ `xml`). */
export const SHAREPOINT_FIELDS =
  'id,BillId,xml,LoaiHD,Year,Month,Term,KHHDon,SHDon,NLap,MCCQT,MaTraCuu,MKHang,NMua,TgTTTBSo';

let chain: Promise<void> = Promise.resolve();

/** Xếp hàng đẩy một hóa đơn. Trả ngay, không chờ. */
export function queueSharepointPush(rec: Record<string, any>, billval: string): void {
  const url = process.env.FLOW_DONGBO_URL;
  if (!url) return;
  chain = chain
    .then(() => push(url, rec, billval))
    .then(() => console.log('[sharepoint] đã đẩy', rec.id))
    .catch(err => console.error('[sharepoint] lỗi', rec.id, err?.message || err));
}

async function push(url: string, rec: Record<string, any>, billval: string): Promise<void> {
  const noti = await fetchCcisPdf(billval, 'NOTI');
  const bill = await fetchCcisPdf(billval, 'BILLPDF');
  const base = `${rec.MKHang || ''}_${rec.KHHDon || ''}-${rec.SHDon || ''}`.replace(/[^\w.-]/g, '_');
  const { xml, ...meta } = rec;
  const body = JSON.stringify({
    ...meta,
    files: [
      { kind: 'NOTI', name: `GiayBao_${base}.pdf`, contentBase64: noti.toString('base64') },
      { kind: 'BILLPDF', name: `HoaDon_${base}.pdf`, contentBase64: bill.toString('base64') },
      { kind: 'XML', name: `HoaDon_${base}.xml`, contentBase64: Buffer.from(String(xml ?? ''), 'utf8').toString('base64') },
    ],
  });

  let last = '';
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err: any) {
      last = err?.message || String(err);
    }
    await new Promise(r => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error(`Flow không nhận sau 3 lần thử (${last})`);
}
