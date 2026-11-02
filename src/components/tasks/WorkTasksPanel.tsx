/**
 * Dòng nhắc việc trên trang Tổng hợp của TVH (user chốt 02/11/2026): chỉ ghi "TVH … còn N việc
 * cần làm" (việc chưa xong giao cho TVH mình / cả khối TVH). Bấm để sang màn Giao việc.
 */
import { useEffect, useMemo, useState } from 'react';
import { ListTodo, ArrowRight } from 'lucide-react';
import { currentUser, listTasks, isForMe, isOverdue, type WorkTask } from '../../lib/workTasks';

export default function WorkTasksPanel({ onOpen }: { onOpen: () => void }) {
  const me = useMemo(currentUser, []);
  const [tasks, setTasks] = useState<WorkTask[] | null>(null);

  useEffect(() => {
    let ok = true;
    listTasks().then(t => { if (ok) setTasks(t); }).catch(() => { if (ok) setTasks([]); });
    return () => { ok = false; };
  }, []);

  if (!tasks) return null;
  const open = tasks.filter(t => t.status !== 'done' && isForMe(t, me));
  const overdue = open.filter(t => isOverdue(t)).length;
  const team = me.areas.length === 1 ? `TVH ${me.areas[0]}` : 'TVH';

  return (
    <button onClick={onOpen}
      className={`vl-alert ${open.length ? 'vl-alert-light-warning' : 'vl-alert-light-success'} w-full text-left flex items-center gap-3 text-sm`}>
      <ListTodo className="w-4 h-4 shrink-0" />
      <span className="flex-1">
        {open.length
          ? <><b>{team}</b> còn <b>{open.length}</b> việc cần làm{overdue > 0 && <> ({overdue} quá hạn)</>}</>
          : <><b>{team}</b> không còn việc cần làm</>}
      </span>
      <ArrowRight className="w-4 h-4 shrink-0" />
    </button>
  );
}
