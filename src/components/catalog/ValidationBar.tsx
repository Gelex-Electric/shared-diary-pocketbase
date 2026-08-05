import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ShieldAlert } from 'lucide-react';
import { type ValidateResult, groupByCheck } from '../../lib/validate';

/**
 * Dải cảnh báo ràng buộc dữ liệu (task 9, phần giao diện).
 *
 * Đặt ở ĐẦU trang thay vì đánh dấu từng dòng: bảng có tới ~700 dòng, chấm cảnh
 * báo trên mỗi dòng vừa nặng vừa loãng. Dải này cho biết ngay "có bao nhiêu vấn
 * đề", mở ra mới xem chi tiết — không chắn đường khi dữ liệu sạch.
 */
export default function ValidationBar({ result }: { result: ValidateResult }) {
  const [open, setOpen] = useState(false);
  const { errors, warnings } = result;
  const total = errors.length + warnings.length;

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold
        bg-[var(--success-soft)] text-[var(--success)] border border-[var(--success)]/30">
        <CheckCircle2 className="w-4 h-4" />Dữ liệu không có lỗi ràng buộc nào.
      </div>
    );
  }

  const tone = errors.length
    ? 'bg-[var(--danger-soft)] border-[var(--danger)]/40'
    : 'bg-[var(--warning-soft)] border-[var(--warning)]/40';

  return (
    <div className={`border ${tone}`}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left">
        <ShieldAlert className={`w-4 h-4 shrink-0 ${errors.length ? 'text-bad' : 'text-warn'}`} />
        <span className="text-xs font-bold text-ink">
          {errors.length > 0 && <span className="text-bad">{errors.length} lỗi</span>}
          {errors.length > 0 && warnings.length > 0 && ' · '}
          {warnings.length > 0 && <span className="text-warn">{warnings.length} cảnh báo</span>}
        </span>
        <span className="text-xs text-soft hidden sm:inline">
          {errors.length ? 'Lỗi làm sai hóa đơn hoặc tổn thất — nên sửa trước.' : 'Cảnh báo: dữ liệu còn thiếu, chưa chặn việc gì.'}
        </span>
        <span className="flex-1" />
        <ChevronDown className={`w-4 h-4 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-[var(--border)] p-3 space-y-4 max-h-80 overflow-y-auto bg-surface">
          {([['Lỗi', errors, 'text-bad'], ['Cảnh báo', warnings, 'text-warn']] as const).map(
            ([label, list, cls]) => list.length === 0 ? null : (
              <section key={label}>
                <p className={`text-xs font-bold uppercase tracking-wide ${cls}`}>
                  {label} ({list.length})
                </p>
                <div className="mt-2 space-y-2">
                  {groupByCheck(list).map(g => (
                    <details key={g.check} className="text-xs">
                      <summary className="cursor-pointer text-ink font-semibold flex items-center gap-1.5">
                        <AlertTriangle className={`w-3 h-3 shrink-0 ${cls}`} />
                        [{g.check}] {g.title} — {g.items.length} trường hợp
                      </summary>
                      <ul className="mt-1 ml-5 space-y-0.5 text-soft">
                        {g.items.slice(0, 30).map((f, i) => <li key={i}>· {f.detail}</li>)}
                        {g.items.length > 30 && (
                          <li className="text-faint">… còn {g.items.length - 30} trường hợp nữa</li>
                        )}
                      </ul>
                    </details>
                  ))}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
