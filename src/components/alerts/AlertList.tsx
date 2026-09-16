import { useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Undo2, MapPin } from 'lucide-react';
import type { AlertRecord } from '../../lib/alerts';
import { setResolved } from '../../lib/alerts';

/**
 * Danh sách cảnh báo của MỘT nhóm.
 *
 * Đổi tên từ `NotificationList` và khác nó ở hai chỗ:
 *   · mỗi dòng có nút "Đánh dấu đã xử lý" (và mở lại) — thay cho việc xoá, vốn
 *     bị khoá hẳn trên collection;
 *   · phân biệt bằng ĐÃ XỬ LÝ / CHƯA, không phải đã đọc / chưa đọc.
 *
 * Bản đã xử lý vẫn hiện, chỉ mờ đi: cần biết sự cố này từng xảy ra và ai đó đã
 * xử lý, chứ không phải nó biến mất.
 */

/** "2026-09-16 08:00:00Z" → "16/09/2026 08:00". */
const fmtWhen = (raw: string) => {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function AlertList({ items, loading, empty, onChanged }: {
  items: AlertRecord[];
  loading: boolean;
  empty: string;
  /** Gọi sau khi đổi trạng thái để nơi cha đếm lại. */
  onChanged: () => void;
}) {
  /* Id đang gửi lệnh — chặn bấm hai lần, và cho thấy có gì đó đang chạy. */
  const [busy, setBusy] = useState<string>('');

  const toggle = async (r: AlertRecord) => {
    setBusy(r.id);
    try {
      if (await setResolved(r.id, !r.resolved)) onChanged();
    } finally {
      setBusy('');
    }
  };

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
        const meters = it.meters ? it.meters.split(',').map(s => s.trim()).filter(Boolean) : [];
        return (
          <div
            key={it.id}
            className={`vl-card flex items-start gap-3 px-4 py-3 transition-colors
              ${it.resolved ? 'opacity-60' : 'border-l-2 border-l-[var(--warning)]'}`}
          >
            <div className={`shrink-0 rounded-lg p-2 ${
              it.resolved ? 'bg-[var(--success-soft)]' : 'bg-[var(--warning-soft)]'}`}>
              {it.resolved
                ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" />
                : <AlertTriangle className="w-4 h-4 text-[var(--warning)]" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-ink">{it.title}</span>
                {it.resolved && (
                  <span className="rounded-full bg-[var(--success)] px-1.5 py-0.5 text-[9px] font-black text-white">
                    ĐÃ XỬ LÝ
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-soft break-words">{it.message}</p>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-faint">
                <span className="font-mono">{fmtWhen(it.created)}</span>
                {/* Rỗng = trải nhiều KCN. Nói thẳng, đừng để người đọc đoán. */}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {it.zone || 'nhiều KCN'}
                </span>
                {meters.length > 0 && <span>{meters.length} công tơ</span>}
              </div>
            </div>

            <button
              onClick={() => toggle(it)}
              disabled={busy === it.id}
              className="vl-btn vl-btn-secondary vl-btn-sm shrink-0 gap-1.5 disabled:opacity-50"
            >
              {busy === it.id
                ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                : it.resolved
                  ? <Undo2 className="w-3.5 h-3.5" />
                  : <CheckCircle2 className="w-3.5 h-3.5" />}
              {it.resolved ? 'Mở lại' : 'Đã xử lý'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
