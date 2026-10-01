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
 * Mở PDF giấy báo / hóa đơn ở tab mới. Mở tab TRƯỚC khi chờ mạng — mở sau `await`
 * thì trình duyệt coi là popup tự bật và chặn.
 */
export async function openEinvoicePdf(einvoiceId: string, type: EinvoicePdfType): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const blob = await (await call(`${einvoiceId}/pdf/${type}`)).blob();
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    tab?.close();
    throw err;
  }
}
