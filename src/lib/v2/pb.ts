/**
 * Kết nối PocketBase cho module Hồ sơ Kho.
 *
 * DÙNG CHUNG client với toàn app (`lib/pocketbase.ts`) — user chốt 07/08.
 *
 * Trước đó module này có client + phiên đăng nhập riêng, vì tưởng app trên
 * staging trỏ PocketBase staging còn dữ liệu kho nằm ở production. Kiểm tra lại
 * biến môi trường thì `VITE_PB_URL` của staging vốn ĐÃ là
 * `https://getc.up.railway.app/pb`, nghĩa là cả app từ lâu đã đọc production.
 * Client riêng chỉ tạo thêm một lần đăng nhập vô ích, nên bỏ.
 *
 * Hệ quả cần nhớ: mọi thao tác GHI trên staging đi thẳng vào dữ liệu thật.
 */
import { pb } from '../pocketbase';

export const pbv2 = pb;

export const V2_PB_URL = pb.baseURL;

export function isAuthed(): boolean {
  return pb.authStore.isValid;
}

/**
 * Lỗi do request bị HUỶ (đổi trang, tải lại chồng nhau) — không phải lỗi thật,
 * người dùng không làm gì được với nó nên đừng hiện thông báo đỏ.
 */
export function isAbort(e: unknown): boolean {
  const err = e as { isAbort?: boolean; name?: string; message?: string };
  return err?.isAbort === true
    || err?.name === 'AbortError'
    || /aborted|autocancell?ed/i.test(String(err?.message ?? ''));
}
