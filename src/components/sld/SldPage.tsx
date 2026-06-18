import { useMemo } from 'react';
import { pb } from '../../lib/pocketbase';
import SldImageViewer from './SldImageViewer';
import SldPdfViewer from './SldPdfViewer';
import { getImageForUser } from './images';

// ===================================================================
// Trang SLD — hiển thị ẢNH bản vẽ (xuất từ CAD) cho từng user.
// Chỉ xem + phóng to/kéo, không cần vẽ lại.
//
// (Bản tương tác React Flow vẫn còn ở ./SldViewer + ./diagrams nếu sau
//  này cần đóng/cắt; xem getDiagramForUser.)
// ===================================================================
export default function SldPage() {
  // PocketBase: id user đang đăng nhập.
  const userId = (pb.authStore.model?.id as string | undefined) ?? undefined;

  const image = useMemo(() => getImageForUser(userId), [userId]);
  const isPdf = image.src.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-800">{image.title}</h2>
        <p className="text-xs text-slate-500">
          {isPdf
            ? 'Dùng thanh công cụ PDF để phóng to/thu nhỏ và cuộn xem bản vẽ.'
            : 'Lăn chuột để phóng to/thu nhỏ, kéo để di chuyển. Bấm nút góc phải để về vừa màn hình.'}
        </p>
      </div>
      <div className="flex-1 min-h-[480px]">
        {isPdf
          ? <SldPdfViewer src={image.src} title={image.title} />
          : <SldImageViewer src={image.src} title={image.title} />}
      </div>
    </div>
  );
}
