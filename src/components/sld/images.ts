// ===================================================================
// CẤU HÌNH BẢN VẼ (xuất từ CAD) cho từng KHU CÔNG NGHIỆP (area).
//
// Mỗi KCN dùng 1 bản vẽ; MỌI user thuộc KCN đó cùng xem bản vẽ này.
// Khoá ánh xạ là field `area` của user (pb.authStore.model.area),
// trùng với danh sách AREAS trong src/lib/pocketbase.ts.
//
// === THÊM / ĐỔI BẢN VẼ (không cần vẽ lại) ===
//   1) Xuất bản vẽ CAD ra PDF (KHUYÊN DÙNG — vector, nét sắc, không mờ).
//      Đừng chuyển PDF -> SVG qua Inkscape (làm mảnh nét, mờ chữ).
//      Có thể dùng SVG/PNG nếu thích, app tự nhận theo đuôi file.
//   2) Bỏ file vào thư mục  public/sld/
//   3) Khai báo bên dưới: KCN nào xem bản vẽ nào.
//   4) git push -> Railway tự deploy.
// ===================================================================

export interface SldImage {
  src: string;
  title: string;
}

/** Bản vẽ mặc định khi area của user chưa được khai báo riêng. */
export const DEFAULT_IMAGE: SldImage = {
  src: '/sld/KCN03.pdf',
  title: 'Sơ đồ một sợi',
};

/** Ánh xạ KCN (area) -> bản vẽ. Khoá phải trùng field `area` của user. */
export const AREA_IMAGE: Record<string, SldImage> = {
  'KCN Số 3':          { src: '/sld/KCN03.pdf',  title: 'Sơ đồ một sợi — KCN Số 3' },
  'KCN Yên Mỹ':        { src: '/sld/KCNYM.pdf',  title: 'Sơ đồ một sợi — KCN Yên Mỹ' },
  'KCN Tiền Hải':      { src: '/sld/KCNTH.pdf',  title: 'Sơ đồ một sợi — KCN Tiền Hải' },
  'KCN Phong Điền':    { src: '/sld/KCNPĐ.pdf',  title: 'Sơ đồ một sợi — KCN Phong Điền' },
  'KCN Thuận Thành I': { src: '/sld/KCNTTI.pdf', title: 'Sơ đồ một sợi — KCN Thuận Thành I' },
};

export function getImageForArea(area?: string): SldImage {
  return (area && AREA_IMAGE[area]) || DEFAULT_IMAGE;
}
