// ===================================================================
// CẤU HÌNH BẢN VẼ (xuất từ CAD) cho từng user.
//
// === THÊM BẢN VẼ MỚI (không cần vẽ lại) ===
//   1) Xuất bản vẽ CAD ra PDF (KHUYÊN DÙNG — vector, nét sắc, không mờ).
//      Đừng chuyển PDF -> SVG qua Inkscape (làm mảnh nét, mờ chữ).
//      Có thể dùng SVG/PNG nếu thích, app tự nhận theo đuôi file.
//   2) Bỏ file vào thư mục  public/sld/
//   3) Khai báo bên dưới: user nào xem bản vẽ nào (đuôi .pdf hay ảnh đều được).
//   4) git push -> Railway tự deploy.
//
// File trong public/ được phục vụ ở đường dẫn gốc, vd:
//   public/sld/so-do-mot-soi.pdf  ->  '/sld/so-do-mot-soi.pdf'
// ===================================================================

export interface SldImage {
  src: string;
  title: string;
}

/** Bản vẽ mặc định khi user chưa được gán riêng.
 *  (Tạm dùng KCN03.pdf cho MỌI tài khoản để xem trước.) */
export const DEFAULT_IMAGE: SldImage = {
  src: '/sld/KCN03.pdf',
  title: 'Sơ đồ một sợi — KCN03',
};

/** Ánh xạ user -> ảnh bản vẽ. Để trống thì mọi user xem ảnh mặc định. */
export const USER_IMAGE: Record<string, SldImage> = {
  // 'userId_A': { src: '/sld/kcn-a.svg', title: 'KCN A' },
  // 'userId_B': { src: '/sld/kcn-b.svg', title: 'KCN B' },
};

export function getImageForUser(userId?: string): SldImage {
  return (userId && USER_IMAGE[userId]) || DEFAULT_IMAGE;
}
