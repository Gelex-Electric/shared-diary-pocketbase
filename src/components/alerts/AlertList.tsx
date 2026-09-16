import { useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Undo2, MapPin, ChevronDown } from 'lucide-react';
import type { AlertRecord, AlertDetail } from '../../lib/alerts';
import { setResolved, detailsOf } from '../../lib/alerts';

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

/**
 * Số có dấu chấm ngăn nghìn; `null` = không đo được, KHÁC 0.
 *
 * Giá trị nhỏ giữ đến 3 chữ số thập phân: lùi 0,2 kWh mà làm tròn thành 0 thì
 * cả cột thành một dãy số 0 vô nghĩa. Giá trị lớn thì phần thập phân không còn
 * quan trọng, bỏ đi cho bảng dễ đọc.
 */
const fmtValue = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  const digits = Math.abs(v) < 10 ? 3 : 0;
  return v.toLocaleString('vi-VN', { maximumFractionDigits: digits });
};

/**
 * Bảng chi tiết từng công tơ của một cảnh báo.
 *
 * Trước đây toàn bộ danh sách công tơ nằm trong `message` dưới dạng một chuỗi
 * phẩy dài — 17 số sê-ri dính liền nhau thì không ai đọc nổi, và không cho biết
 * công tơ của khách nào, lệch bao nhiêu.
 *
 * Cột "Lượng bất thường" để "—" khi KHÔNG ĐO ĐƯỢC (công tơ không có chỉ số thì
 * không có gì để trừ), khác hẳn số 0.
 */
function DetailTable({ rows }: { rows: AlertDetail[] }) {
  const hasValue = rows.some(r => r.value !== null && r.value !== undefined);
  return (
    /* Bảng là thứ DUY NHẤT được phép rộng hơn khung — cuộn ngang trong hộp
       riêng để thân trang không bao giờ cuộn ngang trên máy hẹp. */
    <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="bg-subtle text-faint">
            <th className="px-2.5 py-1.5 text-left font-bold w-10">#</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Số công tơ</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Khách hàng</th>
            <th className="px-2.5 py-1.5 text-left font-bold">KCN</th>
            <th className="px-2.5 py-1.5 text-left font-bold">Chi tiết</th>
            {hasValue && <th className="px-2.5 py-1.5 text-right font-bold whitespace-nowrap">Lượng bất thường</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.meter}-${i}`} className="border-t border-[var(--border)]">
              <td className="px-2.5 py-1.5 text-faint">{i + 1}</td>
              <td className="px-2.5 py-1.5 font-mono font-bold text-ink whitespace-nowrap">{r.meter}</td>
              <td className="px-2.5 py-1.5 text-soft">{r.customer || <span className="text-faint italic">chưa khai</span>}</td>
              <td className="px-2.5 py-1.5 text-soft whitespace-nowrap">{r.zone || '—'}</td>
              <td className="px-2.5 py-1.5 text-soft">{r.note || '—'}</td>
              {hasValue && (
                <td className="px-2.5 py-1.5 text-right font-mono font-bold text-ink whitespace-nowrap">
                  {fmtValue(r.value)}{r.value != null && r.unit ? ` ${r.unit}` : ''}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
  /* Cảnh báo nào đang mở bảng. Mặc định ĐÓNG: một ngày có thể vài cảnh báo,
     mỗi cái vài chục dòng — mở sẵn hết thì phải cuộn mãi mới thấy cái thứ hai. */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpen(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

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
        const rows = detailsOf(it);
        const isOpen = open.has(it.id);
        /*
          Cắt đuôi danh sách sê-ri khỏi câu mô tả: script ghép nó vào `message`
          để bản ghi tự đứng một mình đọc được, nhưng trên màn hình thì bảng bên
          dưới đã liệt kê đầy đủ — để cả hai là một đoạn dài lặp lại vô ích.
        */
        const summary = rows.length ? it.message.split(' — ')[0] : it.message;
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
              <p className="mt-0.5 text-[13px] leading-relaxed text-soft break-words">{summary}</p>
              <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-faint">
                <span className="font-mono">{fmtWhen(it.created)}</span>
                {/* Rỗng = trải nhiều KCN. Nói thẳng, đừng để người đọc đoán. */}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {it.zone || 'nhiều KCN'}
                </span>
                {rows.length > 0 && (
                  <button
                    onClick={() => toggleOpen(it.id)}
                    className="flex items-center gap-1 font-bold text-accent hover:underline"
                  >
                    {rows.length} công tơ
                    <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>
              {isOpen && rows.length > 0 && <DetailTable rows={rows} />}
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
