import { useMemo } from 'react';
import { pb } from '../../lib/pocketbase';
import SldImageViewer from './SldImageViewer';
import SldPdfViewer from './SldPdfViewer';
import { getImageForArea } from './images';

// ===================================================================
// Trang SLD — hiển thị ẢNH bản vẽ (xuất từ CAD) theo KCN (area) của user.
// Mỗi KCN 1 bản vẽ; chỉ xem + phóng to/kéo, không cần vẽ lại.
// ===================================================================
export default function SldPage() {
  // PocketBase: KCN (area) của user đang đăng nhập.
  const area = (pb.authStore.model?.area as string | undefined) ?? undefined;

  const image = useMemo(() => getImageForArea(area), [area]);
  const isPdf = image.src.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-base font-semibold text-ink">{image.title}</h2>
        <p className="text-xs text-soft">
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
