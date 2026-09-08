// ===================================================================
// CẤU HÌNH BẢN VẼ (xuất từ CAD) cho từng KHU CÔNG NGHIỆP (area).
//
// Mỗi KCN dùng 1 bản vẽ; MỌI user thuộc KCN đó cùng xem bản vẽ này.
// Khoá ánh xạ là field `area` của user (pb.authStore.model.area),
// trùng với danh sách AREAS trong src/lib/pocketbase.ts.
//
// === THÊM / ĐỔI BẢN VẼ (không cần vẽ lại) ===
//   1) Xuất bản vẽ CAD ra HTML tự chứa (KHUYÊN DÙNG — plugin
//      mlightcad-cad-html-plugin): vector, có sẵn zoom/pan/đo/layer.
//      Vẫn hỗ trợ PDF / SVG / PNG, app tự nhận theo đuôi file.
//   2) Bỏ file vào thư mục  public/sld/
//   3) Khai báo bên dưới: KCN nào xem bản vẽ nào.
//   4) git push -> Railway tự deploy.
// ===================================================================

export interface SldImage {
  src: string;
  title: string;
}

/** Loại bản vẽ, quyết định dùng viewer nào. */
export type SldKind = 'html' | 'pdf' | 'image';

export function kindOf(src: string): SldKind {
  const s = src.toLowerCase();
  if (s.endsWith('.html') || s.endsWith('.htm')) return 'html';
  if (s.endsWith('.pdf')) return 'pdf';
  return 'image';
}

/** Bản vẽ mặc định khi area của user chưa được khai báo riêng. */
export const DEFAULT_IMAGE: SldImage = {
  src: '/sld/KCN03.html',
  title: 'Sơ đồ một sợi',
};

/** Ánh xạ KCN (area) -> bản vẽ. Khoá phải trùng field `area` của user. */
export const AREA_IMAGE: Record<string, SldImage> = {
  'KCN Số 3':          { src: '/sld/KCN03.html',  title: 'Sơ đồ một sợi — KCN Số 3' },
  'KCN Yên Mỹ':        { src: '/sld/KCNYM.html',  title: 'Sơ đồ một sợi — KCN Yên Mỹ' },
  'KCN Tiền Hải':      { src: '/sld/KCNTH.html',  title: 'Sơ đồ một sợi — KCN Tiền Hải' },
  'KCN Phong Điền':    { src: '/sld/KCNPĐ.html',  title: 'Sơ đồ một sợi — KCN Phong Điền' },
  'KCN Thuận Thành I': { src: '/sld/KCNTTI.html', title: 'Sơ đồ một sợi — KCN Thuận Thành I' },
};

export function getImageForArea(area?: string): SldImage {
  return (area && AREA_IMAGE[area]) || DEFAULT_IMAGE;
}
