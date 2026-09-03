/**
 * Mảnh giao diện dùng chung cho các màn đối chiếu vòng đời vật tư.
 *
 * Tách ra khỏi `AssetLifecycle.tsx` khi màn "Quản lý chung" cũng cần hiển thị
 * chặng hóa đơn (25/08/2026): hai màn vẽ chặng bằng hai đoạn code khác nhau thì
 * sớm muộn cũng lệch nhau về cách đọc dữ liệu.
 */
import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { dmyRange } from '../../lib/dm/lifecycle';
import type { Segment } from '../../lib/dm/lifecycle';

/** Một chặng hóa đơn: khách hàng, quãng thời gian, số HĐ, HSN. */
export function SegmentBar({ seg, dim }: { seg: Segment; dim?: boolean }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${dim ? 'text-faint' : 'text-soft'}`}>
      <span className="font-mono text-xs font-bold text-ink">{seg.mkh}</span>
      <span className="font-mono text-xs">{dmyRange(seg.from, seg.to)}</span>
      <span className="text-[11px]">({seg.count} HĐ)</span>
      {seg.hsn != null && (
        <span className="rounded bg-subtle px-2 py-0.5 text-[11px] font-bold">
          HSN {seg.hsnHistory.join(' → ')}
        </span>
      )}
      {seg.isCurrent && (
        <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[10px] font-bold uppercase text-good">
          còn phát sinh
        </span>
      )}
    </span>
  );
}

/** Dòng nhắc màu vàng — bản gốc ở `AssetLifecycle`, gom về đây để hai màn dùng chung. */
export const Warn = ({ children }: { children: ReactNode }) => (
  <div className="flex items-start gap-1.5 text-[11px] font-semibold leading-snug text-warn">
    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
    <span>{children}</span>
  </div>
);
