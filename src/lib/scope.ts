import { useMemo } from 'react';
import { pb, AREAS, ID_TO_AREA } from './pocketbase';

/**
 * Khối nghiệp vụ đang xem một màn hình.
 *  - 'doi'      : khối Vận hành (Đội) — dữ liệu lọc theo KCN của user, bố cục phẳng.
 *  - 'vanphong' : khối Văn phòng     — toàn bộ KCN, bố cục chia section theo KCN.
 *
 * Quy ước: MỘT màn hình = MỘT component nhận prop `scope`.
 * KHÔNG tạo file `Office*` chép tay bên cạnh bản gốc.
 */
export type Scope = 'doi' | 'vanphong';

/**
 * Danh sách KCN của tài khoản đang đăng nhập, đọc từ `users.area`.
 *
 * Gom về một chỗ thay cho 7 bản chép tay rải trong components. Hai chi tiết
 * giữ lại từ các bản cũ, đều đã kiểm chứng trên PocketBase production 14/08/2026:
 *  - `authStore.model.areas` (số nhiều): collection `users` KHÔNG có field này.
 *    Đọc kèm chỉ để phòng hờ, hiện luôn `undefined`.
 *  - `ID_TO_AREA[item]`: `users.area` là field select chứa TÊN ĐẦY ĐỦ
 *    ("KCN Tiền Hải"…), mã ngắn nằm ở field riêng `users.area2`. Nên phép map
 *    này hiện là no-op, giữ để an toàn nếu sau này đổi sang lưu mã.
 *
 * Tài khoản khối Văn phòng có `area` rỗng → trả mảng rỗng.
 */
export function useUserAreas(): string[] {
  const raw = (pb.authStore.model as any)?.areas ?? pb.authStore.model?.area;
  return useMemo(() => {
    const items: string[] = Array.isArray(raw)
      ? raw
      : typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    return items.map(item => ID_TO_AREA[item] || item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(raw)]);
}

/** Cách một màn hình xử lý phạm vi KCN, tuỳ theo khối đang xem. */
export interface ScopeAreas {
  /** KCN được phép xem. Khối Đội: KCN của user (rỗng → toàn bộ). Văn phòng: toàn bộ. */
  areas: string[];
  /** Có hiện bộ chọn KCN không. Khối Đội chỉ có đúng 1 KCN thì ẩn cho gọn. */
  canPickArea: boolean;
  /** Nhãn mục "tất cả" trong bộ chọn. */
  allLabel: string;
  /** Tiện cho nơi cần rẽ nhánh bố cục. */
  isOffice: boolean;
}

export function useScopeAreas(scope: Scope): ScopeAreas {
  const userAreas = useUserAreas();
  return useMemo(() => {
    if (scope === 'vanphong') {
      return { areas: AREAS, canPickArea: true, allLabel: 'Tất cả KCN', isOffice: true };
    }
    return {
      areas: userAreas.length > 0 ? userAreas : AREAS,
      canPickArea: userAreas.length !== 1,
      allLabel: 'Tất cả khu vực',
      isOffice: false,
    };
  }, [scope, userAreas]);
}
