import { ExternalLink } from 'lucide-react';

// ===================================================================
// Trình xem PDF — nhúng thẳng file PDF (vector, nét sắc, phóng to không vỡ).
// Dùng trình xem PDF sẵn có của trình duyệt (có sẵn zoom/cuộn).
// Tránh chuyển PDF -> SVG (mất nét).
// ===================================================================
export default function SldPdfViewer({ src, title }: { src: string; title?: string }) {
  // #toolbar=1: hiện thanh công cụ; view=FitH: vừa chiều ngang khi mở.
  const url = `${src}#view=FitH&toolbar=1`;
  return (
    <div className="w-full h-full bg-slate-100">
      <object data={url} type="application/pdf" className="w-full h-full">
        {/* Fallback nếu trình duyệt không nhúng được */}
        <div className="flex flex-col items-center justify-center gap-3 h-full text-slate-500">
          <p className="text-sm">Không hiển thị được PDF trực tiếp.</p>
          <a href={src} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1.5 text-blue-600 hover:underline text-sm">
            <ExternalLink className="w-4 h-4" /> Mở {title ?? 'bản vẽ'} trong tab mới
          </a>
        </div>
      </object>
    </div>
  );
}
