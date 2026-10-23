/**
 * Nhóm tài khoản — quyết định màn hình sau đăng nhập (plan 2026-10-23-ba-nhom-dang-nhap-nhom-vat-tu.md).
 *
 *  - `users.nhom` có giá trị → dùng nó (`dm_schema_v22.mjs` thêm trường 23/10/2026).
 *  - `users.nhom` trống → luật cũ theo `area`: có area = Vận hành, trống = Kinh doanh.
 *    Tài khoản tạo trước 23/10 không phải sửa gì.
 *
 * Mọi nơi phân nhóm phải gọi `userGroupOf` — không tự đọc `area` rồi suy tại chỗ.
 * `server/einvoiceApi.ts` chép lại cùng luật (server không import `src/`).
 */
export type UserGroup = 'van_hanh' | 'kinh_doanh' | 'vat_tu';

export const GROUP_LABEL: Record<UserGroup, string> = {
  van_hanh:   'Nhóm Vận Hành',
  kinh_doanh: 'Nhóm Kinh Doanh',
  vat_tu:     'Nhóm Vật Tư',
};

/** Nhãn ngắn cho tab đăng nhập (user chốt 23/10/2026). */
export const GROUP_SHORT: Record<UserGroup, string> = {
  van_hanh:   'Vận Hành',
  kinh_doanh: 'Kinh Doanh',
  vat_tu:     'Vật Tư',
};

const GROUPS: UserGroup[] = ['van_hanh', 'kinh_doanh', 'vat_tu'];

export function userGroupOf(record: { [key: string]: unknown } | null | undefined): UserGroup {
  const nhom = typeof record?.nhom === 'string' ? record.nhom.trim() : '';
  if ((GROUPS as string[]).includes(nhom)) return nhom as UserGroup;
  const area = record?.area;
  const hasArea = Array.isArray(area) ? area.length > 0 : typeof area === 'string' && !!area.trim();
  return hasArea ? 'van_hanh' : 'kinh_doanh';
}
