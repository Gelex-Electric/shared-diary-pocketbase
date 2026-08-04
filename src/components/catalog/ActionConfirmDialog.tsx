import { useState, useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { EventPayload } from '../../lib/assign';

export interface ActionRequest {
  title: string;
  detail: string;
  /** Thao tác cần ngày hiệu lực (treo/tháo) — ngày ngoài hiện trường. */
  needsDate: boolean;
  /** Sinh vt_event append-only ⇒ không hoàn tác được. */
  irreversible: boolean;
  /** Cảnh báo riêng cho lô đang chọn (VD 2 dòng bị bỏ qua). */
  warnings?: string[];
}

/**
 * Xác nhận trước khi ghi. Đây là chỗ DUY NHẤT nhập được ngày hiệu lực thật và
 * số biên bản — thiếu ngày đúng thì HSN theo thời điểm sẽ sai.
 */
export default function ActionConfirmDialog({
  request, onCancel, onConfirm,
}: {
  request: ActionRequest | null;
  onCancel: () => void;
  onConfirm: (p: EventPayload) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [documentNo, setDocumentNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (request) { setDate(today); setDocumentNo(''); setNote(''); setBusy(false); }
  }, [request, today]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel, busy]);

  if (!request) return null;
  const future = date > today;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onCancel()}>
      <div className="vl-card w-full max-w-lg p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-ink">{request.title}</h3>
          <button onClick={onCancel} disabled={busy} className="text-faint hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-dim whitespace-pre-line bg-subtle rounded p-3">{request.detail}</p>

        {request.warnings && request.warnings.length > 0 && (
          <div className="text-xs text-warn bg-[var(--warning-soft)] rounded p-3 space-y-1">
            {request.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}
              </p>
            ))}
          </div>
        )}

        {request.irreversible && (
          <div className="flex items-start gap-2 text-xs text-warn bg-[var(--warning-soft)] rounded p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Ghi vào sổ cái vật tư. Sổ cái <strong>không sửa/xoá được</strong> — ghi sai thì
              phải ghi nghiệp vụ ngược lại, không xoá được vết cũ.
            </span>
          </div>
        )}

        {request.needsDate && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-soft">Ngày hiệu lực *</span>
              <input type="date" value={date} max={today} onChange={e => setDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
              <span className="text-[0.7rem] text-faint">Ngày thao tác thật ngoài hiện trường</span>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-soft">Số biên bản</span>
              <input type="text" value={documentNo} placeholder="VD: BB-2026-014"
                onChange={e => setDocumentNo(e.target.value)}
                className="mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
            </label>
          </div>
        )}

        <label className="block">
          <span className="text-xs font-semibold text-soft">Ghi chú</span>
          <textarea value={note} rows={2} onChange={e => setNote(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none resize-none" />
        </label>

        {future && <p className="text-xs text-bad">Ngày hiệu lực không được ở tương lai.</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={busy}
            className="vl-btn vl-btn-secondary">
            Hủy
          </button>
          <button onClick={() => { setBusy(true); onConfirm({ date, documentNo, note }); }}
            disabled={busy || future}
            className="vl-btn vl-btn-primary">
            {busy ? 'Đang ghi...' : 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>
  );
}
