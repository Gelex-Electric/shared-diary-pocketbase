import { ExternalLink } from 'lucide-react';

// ===================================================================
// Trình xem bản vẽ HTML — bản vẽ CAD xuất ra HTML tự chứa
// (mlightcad-cad-html-plugin): có sẵn canvas WebGL + thanh công cụ
// zoom/pan/đo/layer riêng. Nhúng qua <iframe>, không can thiệp bên trong.
// ===================================================================
export default function SldHtmlViewer({ src, title }: { src: string; title?: string }) {
  return (
    <div className="w-full h-full bg-subtle relative">
      <iframe
        src={src}
        title={title ?? 'Sơ đồ một sợi'}
        className="w-full h-full border-0 block"
      />
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        title="Mở bản vẽ trong tab mới"
        className="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                   bg-[var(--surface)] border border-[var(--border)] text-xs text-soft
                   hover:text-ink shadow-sm"
      >
        <ExternalLink className="w-3.5 h-3.5" /> Tab mới
      </a>
    </div>
  );
}
