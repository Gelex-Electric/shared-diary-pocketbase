/**
 * Gọi API hóa đơn điện tử của server (`server/einvoiceApi.ts`) — BILLVAL + PDF CCIS.
 * Khóa BILLVAL chỉ ở server; trình duyệt chỉ gửi token PocketBase của người dùng.
 */
import { pb } from './pocketbase';

export type EinvoicePdfType = 'NOTI' | 'BILLPDF';

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`/api/einvoice/${path}`, {
    ...init,
    headers: { Authorization: pb.authStore.token, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || `Lỗi máy chủ (HTTP ${res.status})`);
  }
  return res;
}

/** Tra CCIS, dựng BILLVAL và lưu vào `einvoice` (server làm hết). */
export async function requestBillval(einvoiceId: string): Promise<{ departmentId: number; figureBookId: number }> {
  const res = await call(`${einvoiceId}/billval`, { method: 'POST' });
  return res.json();
}

/**
 * Tải PDF giấy báo / hóa đơn (server lấy từ CCIS, không lưu). Trả file để xem NGAY TRONG APP
 * (`ui/PdfViewer`) — trước đây mở tab mới từ lúc bấm nên hiện `about:blank` trong lúc chờ
 * (user không muốn, 02/10/2026). Tên file lấy từ `Content-Disposition` của server.
 */
export async function fetchEinvoicePdf(einvoiceId: string, type: EinvoicePdfType): Promise<{ blob: Blob; fileName: string }> {
  const res = await call(`${einvoiceId}/pdf/${type}`);
  const cd = res.headers.get('content-disposition') || '';
  const fileName = (cd.match(/filename="?([^";]+)"?/) || [])[1] || `${type === 'NOTI' ? 'GiayBao' : 'HoaDon'}.pdf`;
  return { blob: await res.blob(), fileName };
}
