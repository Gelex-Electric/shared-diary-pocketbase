/**
 * Helper đọc dữ liệu từ các collection PocketBase thay cho các file CSV trong public/.
 * Dùng cho các dataset đã di trú sang PB (Task 1+: tloss_daily, ...).
 *
 * Yêu cầu ĐĂNG NHẬP: các collection dữ liệu đặt listRule = `@request.auth.id != ""`,
 * nên pb.authStore phải hợp lệ (người dùng đã login) khi gọi các hàm này.
 */
import { pb } from './pocketbase';

/**
 * Đọc TOÀN BỘ record của một collection (tự phân trang qua getFullList).
 * Trả [] nếu collection rỗng. Ném lỗi nếu lỗi mạng/quyền (để caller xử lý).
 */
export async function fetchAll<T = Record<string, unknown>>(
  collection: string,
  options: { filter?: string; sort?: string } = {},
): Promise<T[]> {
  return pb.collection(collection).getFullList<T>({
    batch: 500,
    requestKey: null, // không auto-cancel khi gọi song song nhiều nơi
    ...options,
  });
}
