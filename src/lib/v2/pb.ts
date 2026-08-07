/**
 * Client PocketBase RIÊNG cho module vật tư làm lại (v2).
 *
 * Vì sao không dùng chung `lib/pocketbase.ts` (user chốt 07/08):
 *   - Phần làm lại phải chạy trên DỮ LIỆU THẬT của production, trong khi app
 *     trên nhánh staging vẫn trỏ PocketBase staging qua `VITE_PB_URL`.
 *   - Tách hẳn client thì màn hình cũ không thể vô tình ghi sang production,
 *     và module mới không phụ thuộc biến môi trường của môi trường đang chạy.
 *
 * Kèm theo là kho token riêng (`V2_AUTH_KEY`): đăng nhập ở module này KHÔNG
 * đụng tới phiên đăng nhập của app cũ, và ngược lại. Đổi lại, người dùng phải
 * đăng nhập một lần nữa khi mở module — đây là cái giá của việc nói chuyện với
 * hai server khác nhau, không né được.
 */
import PocketBase, { LocalAuthStore } from 'pocketbase';

/** PocketBase PRODUCTION. Cố định, KHÔNG đọc `VITE_PB_URL`. */
export const V2_PB_URL = 'https://getc.up.railway.app/pb';

const V2_AUTH_KEY = 'pb_v2_auth';

export const pbv2 = new PocketBase(V2_PB_URL, new LocalAuthStore(V2_AUTH_KEY));

export function isAuthed(): boolean {
  return pbv2.authStore.isValid;
}

export async function loginV2(email: string, password: string) {
  return pbv2.collection('users').authWithPassword(email, password);
}

export function logoutV2() {
  pbv2.authStore.clear();
}

/**
 * Lỗi do request bị HUỶ (đổi trang, tải lại chồng nhau) — không phải lỗi thật.
 * Sao chép có chủ ý từ `lib/catalog.ts` để module v2 không phụ thuộc code cũ.
 */
export function isAbort(e: unknown): boolean {
  const err = e as { isAbort?: boolean; name?: string; message?: string };
  return err?.isAbort === true
    || err?.name === 'AbortError'
    || /aborted|autocancell?ed/i.test(String(err?.message ?? ''));
}
