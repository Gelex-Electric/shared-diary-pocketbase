import { useMemo, useState, lazy, Suspense } from 'react';
import { Image, Table2, Loader2 } from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import SldImageViewer from './SldImageViewer';
import SldPdfViewer from './SldPdfViewer';
import { getImageForArea } from './images';

// Lazy: ReactFlow + elkjs (~nặng) chỉ tải khi mở chế độ quản lý/sơ đồ động,
// không nằm trong bundle chính (giữ tải trang ban đầu nhẹ cho mọi user).
const SldNodeManager = lazy(() => import('./SldNodeManager'));

type Mode = 'image' | 'editor';

// ===================================================================
// Trang SLD — 2 chế độ:
//  - 'image':  ẢNH/PDF bản vẽ CAD theo KCN (area) của user (chỉ xem + phóng to).
//  - 'editor': BẢNG quản lý cây thiết bị (sld_node) + sơ đồ một sợi tự vẽ lại.
// ===================================================================
export default function SldPage() {
  const [mode, setMode] = useState<Mode>('image');

  const area = (pb.authStore.model?.area as string | undefined) ?? undefined;
  const image = useMemo(() => getImageForArea(area), [area]);
  const isPdf = image.src.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {mode === 'image' ? image.title : 'Quản lý sơ đồ một sợi'}
          </h2>
          <p className="text-xs text-soft">
            {mode === 'image'
              ? (isPdf
                  ? 'Dùng thanh công cụ PDF để phóng to/thu nhỏ và cuộn xem bản vẽ.'
                  : 'Lăn chuột để phóng to/thu nhỏ, kéo để di chuyển. Bấm nút góc phải để về vừa màn hình.')
              : 'Sửa bảng cây thiết bị bên trái — sơ đồ bên phải tự cập nhật. Không cần vẽ tay toạ độ.'}
          </p>
        </div>
        <div className="flex rounded-lg border border-[var(--border)] overflow-hidden text-sm">
          <button
            onClick={() => setMode('image')}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${mode === 'image' ? 'bg-accent text-white' : 'text-soft hover:text-ink'}`}
          >
            <Image className="w-4 h-4" /> Bản vẽ CAD
          </button>
          <button
            onClick={() => setMode('editor')}
            className={`flex items-center gap-1.5 px-3 py-1.5 ${mode === 'editor' ? 'bg-accent text-white' : 'text-soft hover:text-ink'}`}
          >
            <Table2 className="w-4 h-4" /> Bảng → Sơ đồ
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-[480px]">
        {mode === 'editor'
          ? <Suspense fallback={<div className="flex items-center justify-center h-full text-soft"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Đang tải trình quản lý…</div>}>
              <SldNodeManager />
            </Suspense>
          : isPdf
            ? <SldPdfViewer src={image.src} title={image.title} />
            : <SldImageViewer src={image.src} title={image.title} />}
      </div>
    </div>
  );
}
