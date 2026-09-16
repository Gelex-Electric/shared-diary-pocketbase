import { CheckCircle2, Info, AlertTriangle, CreditCard, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isUnread, type NotificationRecord } from '../../lib/notifications';

/**
 * Danh sách thông báo của MỘT nhóm.
 *
 * Biểu tượng và màu lấy theo `type` (payment / warning / info) — giữ đúng quy
 * ước của chuông cũ, để cùng một thông báo trông giống nhau ở hai chỗ. `kind`
 * chỉ quyết định nó nằm ở sub-side nào, không đổi hình thức.
 */

const TONE: Record<string, { icon: LucideIcon; wrap: string; text: string }> = {
  payment: { icon: CreditCard,     wrap: 'bg-[var(--success-soft)]', text: 'text-[var(--success)]' },
  warning: { icon: AlertTriangle,  wrap: 'bg-[var(--warning-soft)]', text: 'text-[var(--warning)]' },
  info:    { icon: Info,           wrap: 'bg-accent-soft',           text: 'text-accent' },
};
const toneOf = (type?: string) => TONE[type ?? ''] ?? TONE.info;

/** "2026-09-16 08:00:00Z" → "16/09/2026 08:00". */
const fmtWhen = (raw: string) => {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function NotificationList({ items, lastRead, loading, empty }: {
  items: NotificationRecord[];
  /** Mốc đọc lúc MỞ màn — giữ nguyên trong suốt phiên xem để dấu "mới" không
   *  biến mất ngay trước mắt người dùng. */
  lastRead: string;
  loading: boolean;
  empty: string;
}) {
  if (loading) {
    return (
      <div className="vl-card px-6 py-12 text-center text-faint">
        <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="vl-card px-6 py-12 text-center">
        <CheckCircle2 className="w-6 h-6 text-[var(--success)] mx-auto mb-2" />
        <p className="text-sm italic text-faint">{empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map(it => {
        const tone = toneOf(it.type);
        const Icon = tone.icon;
        const fresh = isUnread(it, lastRead);
        return (
          <div
            key={it.id}
            className={`vl-card flex items-start gap-3 px-4 py-3 transition-colors
              ${fresh ? 'border-l-2 border-l-accent' : ''}`}
          >
            <div className={`shrink-0 rounded-lg p-2 ${tone.wrap}`}>
              <Icon className={`w-4 h-4 ${tone.text}`} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-ink">{it.title}</span>
                {fresh && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-black text-white">MỚI</span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-soft break-words">{it.message}</p>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-faint">
                <span className="font-mono">{fmtWhen(it.created)}</span>
                {it.mkh && <span className="font-mono">{it.mkh}</span>}
                {it.area && <span>{it.area}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
