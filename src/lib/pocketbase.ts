import PocketBase from 'pocketbase';

export const pb = new PocketBase('https://getc.up.railway.app');

export const AREAS = [
  'KCN Tiền Hải', 'KCN Phong Điền', 'KCN Thuận Thành I',
  'KCN Yên Mỹ', 'KCN Số 3'
];

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
