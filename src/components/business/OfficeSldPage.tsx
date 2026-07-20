import { useState } from 'react';
import { AREAS } from '../../lib/pocketbase';
import { kcnColorOf } from '../../lib/kcnColors';
import SldPdfViewer from '../sld/SldPdfViewer';
import SldImageViewer from '../sld/SldImageViewer';
import { getImageForArea } from '../sld/images';

// ===================================================================
// Sơ đồ một sợi — bản khối Văn phòng.
// Thanh tab ngang 5 KCN; mỗi tab hiển thị bản vẽ (PDF/ảnh) của KCN đó.
// Tái dùng map AREA_IMAGE + viewer sẵn có của module sld/.
// ===================================================================
export default function OfficeSldPage() {
  const [area, setArea] = useState<string>(AREAS[0]);

  const image = getImageForArea(area);
  const isPdf = image.src.toLowerCase().endsWith('.pdf');

  return (
    <div className="flex flex-col h-full">
      {/* Thanh tab ngang các KCN */}
      <div className="px-3 pt-3 border-b border-[var(--border)]">
        <div className="flex flex-wrap gap-1.5">
          {AREAS.map(a => {
            const c = kcnColorOf(a);
            const active = a === area;
            return (
              <button
                key={a}
                onClick={() => setArea(a)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-bold border-b-2 transition-colors ${
                  active
                    ? `${c.bg} ${c.text} ${c.border.replace('border-', 'border-b-')}`
                    : 'text-soft border-b-transparent hover:bg-subtle'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tiêu đề bản vẽ */}
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-base font-semibold text-ink">{image.title}</h2>
        <p className="text-xs text-soft">
          {isPdf
            ? 'Dùng thanh công cụ PDF để phóng to/thu nhỏ và cuộn xem bản vẽ.'
            : 'Lăn chuột để phóng to/thu nhỏ, kéo để di chuyển. Bấm nút góc phải để về vừa màn hình.'}
        </p>
      </div>

      {/* Viewer */}
      <div className="flex-1 min-h-[480px]">
        {isPdf
          ? <SldPdfViewer key={area} src={image.src} title={image.title} />
          : <SldImageViewer key={area} src={image.src} title={image.title} />}
      </div>
    </div>
  );
}
