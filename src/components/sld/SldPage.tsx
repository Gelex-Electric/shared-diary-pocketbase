import { useMemo, useState } from 'react';
import { pb } from '../../lib/pocketbase';
import SldImageViewer from './SldImageViewer';
import SldPdfViewer from './SldPdfViewer';
import { getImageForArea, AREA_IMAGE } from './images';
import { Tabs, type TabItem } from '../ui/Tabs';

// ===================================================================
// Trang SLD — hiển thị ẢNH bản vẽ (xuất từ CAD) theo KCN (area).
// Mỗi KCN 1 bản vẽ; chỉ xem + phóng to/kéo, không cần vẽ lại.
//
// - Vận hành (mặc định): 1 bản vẽ theo `area` của tài khoản.
// - Kinh doanh (`zoneTabs`): thanh tab ngang cho từng KCN, đổi bản vẽ theo tab.
// ===================================================================
interface Props {
  /** Bật thanh tab ngang chọn KCN (khối Kinh doanh xem toàn bộ). */
  zoneTabs?: boolean;
}

const ZONE_TABS: TabItem<string>[] = Object.keys(AREA_IMAGE).map(area => ({
  id: area,
  label: area,
}));

export default function SldPage({ zoneTabs = false }: Props) {
  // PocketBase: KCN (area) của user đang đăng nhập.
  const area = (pb.authStore.model?.area as string | undefined) ?? undefined;

  // Khối Kinh doanh: KCN đang chọn qua tab (mặc định KCN đầu danh sách).
  const [selectedArea, setSelectedArea] = useState<string>(ZONE_TABS[0]?.id ?? '');

  const activeArea = zoneTabs ? selectedArea : area;
  const image = useMemo(() => getImageForArea(activeArea), [activeArea]);
  const isPdf = image.src.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] space-y-3">
        {zoneTabs && (
          <Tabs tabs={ZONE_TABS} value={selectedArea} onChange={setSelectedArea} />
        )}
        <div>
          <h2 className="text-base font-semibold text-ink">{image.title}</h2>
          <p className="text-xs text-soft">
            {isPdf
              ? 'Dùng thanh công cụ PDF để phóng to/thu nhỏ và cuộn xem bản vẽ.'
              : 'Lăn chuột để phóng to/thu nhỏ, kéo để di chuyển. Bấm nút góc phải để về vừa màn hình.'}
          </p>
        </div>
      </div>
      <div className="flex-1 min-h-[480px]">
        {isPdf
          ? <SldPdfViewer src={image.src} title={image.title} />
          : <SldImageViewer src={image.src} title={image.title} />}
      </div>
    </div>
  );
}
