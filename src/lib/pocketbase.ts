import PocketBase from 'pocketbase';

const pbUrl = import.meta.env.VITE_PB_URL || 'https://getc.up.railway.app/pb';

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
