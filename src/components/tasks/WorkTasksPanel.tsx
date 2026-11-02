/**
 * Khối "Việc được giao" trên trang Tổng hợp của TVH (user yêu cầu 02/11/2026): việc chưa xong
 * giao cho TVH mình / cả khối TVH, gấp + quá hạn lên đầu. Bấm để sang màn Giao việc.
 */
import { useEffect, useMemo, useState } from 'react';
import { ListTodo, ArrowRight, CalendarClock, AlertTriangle, User, CheckCircle2 } from 'lucide-react';
import { Panel, EmptyState } from '../ui/dashboard';
import { STATUS_LABEL, currentUser, listTasks, isForMe, isOverdue, targetLabel, type WorkTask } from '../../lib/workTasks';

const fmtDay = (d: string) => (d ? d.split('-').reverse().join('/') : '');
const MAX_ROWS = 6;

export default function WorkTasksPanel({ onOpen }: { onOpen: () => void }) {
  const me = useMemo(currentUser, []);
  const [tasks, setTasks] = useState<WorkTask[] | null>(null);

  useEffect(() => {
    let ok = true;
    listTasks().then(t => { if (ok) setTasks(t); }).catch(() => { if (ok) setTasks([]); });
    return () => { ok = false; };
  }, []);

  const open = (tasks ?? [])
    .filter(t => t.status !== 'done' && isForMe(t, me))
    .sort((a, b) =>
      Number(isOverdue(b)) - Number(isOverdue(a))
      || Number(b.priority === 'high') - Number(a.priority === 'high')
      || (a.deadline || '9999').localeCompare(b.deadline || '9999'));

  return (
    <Panel
      title="Việc được giao"
      sub={tasks ? `${open.length} việc chưa xong` : 'Đang tải…'}
      icon={ListTodo}
      actions={(
        <button onClick={onOpen} className="vl-btn vl-btn-secondary vl-btn-sm gap-1.5">
          Xem tất cả <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    >
      {tasks && open.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Không có việc đang chờ" />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {open.slice(0, MAX_ROWS).map(t => {
            const overdue = isOverdue(t);
            return (
              <li key={t.id}>
                <button onClick={onOpen} className="w-full text-left px-5 py-3 hover:bg-subtle transition-colors flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{t.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-soft">
                      <span className="inline-flex items-center gap-1"><User className="w-3 h-3" />{targetLabel(t)}</span>
                      {t.created_by_name && <span>Giao bởi {t.created_by_name}</span>}
                      {t.deadline && (
                        <span className={`inline-flex items-center gap-1 ${overdue ? 'text-bad font-bold' : ''}`}>
                          {overdue ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
                          {fmtDay(t.deadline)}
                        </span>
                      )}
                    </p>
                  </div>
                  {t.priority === 'high' && <span className="vl-badge-danger px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0">Gấp</span>}
                  <span className={`${t.status === 'doing' ? 'vl-badge-primary' : 'vl-badge-warning'} px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0`}>
                    {STATUS_LABEL[t.status]}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open.length > MAX_ROWS && (
        <p className="px-5 py-2 text-[11px] text-faint border-t border-[var(--border)]">Còn {open.length - MAX_ROWS} việc nữa</p>
      )}
    </Panel>
  );
}
