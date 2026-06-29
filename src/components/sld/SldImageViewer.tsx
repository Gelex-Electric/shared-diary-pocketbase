import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

// ===================================================================
// Trình xem ẢNH bản vẽ (SVG/PNG/PDF-ảnh) xuất từ CAD.
// Không cần vẽ lại — chỉ hiển thị + phóng to/thu nhỏ/kéo.
// Dùng cho trường hợp đã có bản vẽ hoàn chỉnh, không cần tương tác.
// ===================================================================
export default function SldImageViewer({ src, title }: { src: string; title?: string }) {
  return (
    <div className="relative w-full h-full bg-subtle">
      <TransformWrapper
        initialScale={1}
        minScale={0.2}
        maxScale={8}
        centerOnInit
        wheel={{ step: 0.1 }}
        doubleClick={{ mode: 'zoomIn' }}
      >
        {({ zoomIn, zoomOut, resetTransform }) => (
          <>
            {/* Nút điều khiển */}
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
              <button onClick={() => zoomIn()} title="Phóng to"
                className="w-9 h-9 flex items-center justify-center rounded-md bg-surface border border-[var(--border)] shadow-sm hover:bg-subtle text-dim">
                <ZoomIn className="w-4 h-4" />
              </button>
              <button onClick={() => zoomOut()} title="Thu nhỏ"
                className="w-9 h-9 flex items-center justify-center rounded-md bg-surface border border-[var(--border)] shadow-sm hover:bg-subtle text-dim">
                <ZoomOut className="w-4 h-4" />
              </button>
              <button onClick={() => resetTransform()} title="Vừa màn hình"
                className="w-9 h-9 flex items-center justify-center rounded-md bg-surface border border-[var(--border)] shadow-sm hover:bg-subtle text-dim">
                <Maximize className="w-4 h-4" />
              </button>
            </div>

            <TransformComponent
              wrapperStyle={{ width: '100%', height: '100%' }}
              contentStyle={{ width: '100%', height: '100%' }}
            >
              <img
                src={src}
                alt={title ?? 'Sơ đồ một sợi'}
                draggable={false}
                style={{ width: '100%', height: 'auto', userSelect: 'none' }}
              />
            </TransformComponent>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
