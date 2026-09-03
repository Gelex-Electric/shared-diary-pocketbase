import PocketBase from 'pocketbase';

/**
 * URL PocketBase.
 *
 * Đọc được ở CẢ HAI môi trường, và phải kiểm tra bằng `typeof` chứ không dùng
 * thẳng tên biến:
 *  - trong trình duyệt (Vite) có `import.meta.env`, KHÔNG có `process`
 *    → viết thẳng `process.env` là ReferenceError, trắng trang toàn app;
 *  - trong script chạy bằng tsx thì ngược lại.
 * Cả hai đều thiếu thì rơi về URL production.
 */
const viteUrl = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_PB_URL : undefined;
const nodeUrl = typeof process !== 'undefined' ? process.env?.VITE_PB_URL : undefined;
const pbUrl = viteUrl || nodeUrl || 'https://getc.up.railway.app/pb';

export const pb = new PocketBase(pbUrl);

export const AREAS = [
  'KCN Tiền Hải', 'KCN Phong Điền', 'KCN Thuận Thành I',
  'KCN Yên Mỹ', 'KCN Số 3'
];

// Map for display names to IDs
// If your 'areas' field in collections stores IDs, update these values to match the IDs in PocketBase.
// If it stores names, you can keep them as names or leave them as is.
export const AREA_IDS: Record<string, string> = {
  'KCN Tiền Hải':      'KCN Tiền Hải',
  'KCN Phong Điền':    'KCN Phong Điền',
  'KCN Thuận Thành I': 'KCN Thuận Thành I',
  'KCN Yên Mỹ':        'KCN Yên Mỹ',
  'KCN Số 3':          'KCN Số 3'
};

// Reverse map to get Name from ID
export const ID_TO_AREA: Record<string, string> = Object.fromEntries(
  Object.entries(AREA_IDS).map(([name, id]) => [id, name])
);

export const AREA_TO_CLASS: Record<string, string> = {
  'KCN Tiền Hải':      'KCN-Tien-Hai',
  'KCN Phong Điền':    'KCN-Phong-Dien',
  'KCN Thuận Thành I': 'KCN-Thuan-Thanh-I',
  'KCN Yên Mỹ':        'KCN-Yen-My',
  'KCN Số 3':          'KCN-So-3'
};

export function getSafeClassName(area = '') {
  return AREA_TO_CLASS[area] || 'KCN-Tien-Hai';
}
