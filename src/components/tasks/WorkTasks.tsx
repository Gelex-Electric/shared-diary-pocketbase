/**
 * Màn "Giao việc" — nhiệm vụ giao tay giữa các nhóm (plan 2026-11-02-viec-can-lam-giao-viec.md).
 * Một danh sách chung cho cả 3 nhóm, dạng danh sách kiểu Microsoft To Do / Todoist (user chốt
 * 02/11/2026): nhóm theo hạn (Quá hạn / Hôm nay / Sắp tới / Không hạn), "Đã xong" thu gọn,
 * nút Hoàn thành / Hoàn tác (user chốt 04/11/2026), ô thêm nhanh. Bấm dòng để mở chi tiết: checklist con + bình luận dạng hội thoại. Quyền xem `lib/workTasks.ts` (canEdit / canWork).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ListTodo, Plus, Users, Inbox, CalendarClock, Pencil, Trash2, Send, CheckSquare, Square, X,
  AlertTriangle, Circle, CircleDot, CheckCircle2, ChevronRight, Flag, MessageSquare, Check, Undo2,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/dashboard';
import { RichTextEditor, RichTextView } from '../ui/RichText';
import { FormModal, Field, TextInput, INPUT_CLS } from '../dm/entryUi';
import { toast } from '../../lib/toast';
import { GROUP_LABEL, type UserGroup } from '../../lib/userGroup';
import { AREAS } from '../../lib/pocketbase';
import {
  DESCRIPTION_MAX, STATUS_LABEL, currentUser, listTasks, createTask, updateTask, setStatus, setChecklist,
  deleteTask, listComments, addComment, recallComment, commentCounts, canEdit, canWork, isOverdue,
  isForMyTeam, targetLabel,
  type WorkTask, type TaskStatus, type TaskInput, type TaskComment, type ChecklistItem, type Me,
} from '../../lib/workTasks';

/** Không có tab 'Việc của tôi': cá nhân dùng chung tài khoản TVH (user chốt 02/11/2026). */
type Filter = 'group' | 'created' | 'all';
const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
const PRIORITY_OPTIONS = [{ value: 'normal', label: 'Thường' }, { value: 'high', label: 'Gấp' }];
const STATUS_OPTIONS = STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }));

const fmtDay = (d: string) => (d ? d.split('-').reverse().join('/') : '');
const fmtTime = (iso: string) => {
  const d = new Date(iso.replace(' ', 'T'));
  return isNaN(+d) ? '' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const emptyForm = (me: Me): TaskInput => ({
  title: '', description: '', priority: 'normal', assignee_group: 'van_hanh',
  // TVH mặc định giao trong TVH mình; khối khác mặc định cả khối TVH.
  assignee_area: me.group === 'van_hanh' ? me.areas[0] ?? '' : '',
  assignee: '', assignee_name: '', deadline: '', checklist: [],
});

/**
 * Đích giao mã hoá trong một ô chọn: `block:<nhóm>` | `team:<KCN>`. Mỗi TVH chỉ có MỘT tài
 * khoản dùng chung (kiểm 02/11/2026) nên giao theo TVH/khối; ô tên người đã bỏ (user chốt 04/11/2026),
 * việc cũ vẫn giữ `assignee_name`. TVH giao trong TVH mình; Kinh Doanh: cả khối TVH, một TVH, khối mình.
 * Khối Vật Tư chưa dùng Giao việc (user chốt 05/11/2026) nên không phải đích giao.
 */
function targetOptions(me: Me) {
  const team = (a: string) => ({ value: `team:${a}`, label: `TVH ${a}` });
  if (me.group === 'van_hanh') return (me.areas.length ? me.areas : AREAS).map(team);
  return [
    { value: 'block:van_hanh', label: 'Cả khối TVH' },
    ...AREAS.map(team),
    { value: 'block:kinh_doanh', label: GROUP_LABEL.kinh_doanh },
  ];
}

const targetOf = (f: TaskInput) => (f.assignee_area ? `team:${f.assignee_area}` : `block:${f.assignee_group}`);

function applyTarget(v: string): Pick<TaskInput, 'assignee_group' | 'assignee_area'> {
  const [kind, id] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
  if (kind === 'team') return { assignee_group: 'van_hanh', assignee_area: id };
  return { assignee_group: id as UserGroup, assignee_area: '' };
}

export default function WorkTasks() {
  const me = useMemo(currentUser, []);
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('group');
  const [form, setForm] = useState<TaskInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const [quick, setQuick] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [commentCount, setCommentCount] = useState<Record<string, number>>({});

  const reload = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([listTasks(), commentCounts().catch(() => ({}))]);
      setTasks(t);
      setCommentCount(c);
      setError('');
    } catch (e) {
      setError(`Không tải được danh sách việc: ${errMsg(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** Chạy một thao tác ghi rồi nạp lại; lỗi hiện ở thanh đỏ đầu màn. */
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await reload(); return true; } catch (e) { setError(errMsg(e)); return false; }
  };

  const visible = tasks.filter(t =>
    filter === 'all' ? true
    : filter === 'created' ? t.created_by === me.id
    : isForMyTeam(t, me));

  const teamOpen = tasks.filter(t => t.status !== 'done' && isForMyTeam(t, me)).length;
  const teamLabel = me.group === 'van_hanh' && me.areas.length === 1 ? `TVH ${me.areas[0]}` : GROUP_LABEL[me.group];

  const openNew = () => { setEditingId(null); setForm(emptyForm(me)); };
  const openEdit = (t: WorkTask) => {
    setEditingId(t.id);
    setForm({
      title: t.title, description: t.description, priority: t.priority, assignee_group: t.assignee_group,
      assignee_area: t.assignee_area, assignee: t.assignee, assignee_name: t.assignee_name, deadline: t.deadline, checklist: t.checklist,
    });
  };

  const submit = async () => {
    if (!form || !form.title.trim()) { setError('Nhập tiêu đề việc.'); return; }
    if (form.description.length > DESCRIPTION_MAX) { setError('Mô tả quá dài, hãy rút gọn.'); return; }
    setSaving(true);
    const input = { ...form, title: form.title.trim(), checklist: form.checklist.filter(c => c.text.trim()) };
    await run(() => (editingId ? updateTask(editingId, input) : createTask(input, me)));
    setSaving(false);
    setForm(null);
  };

  const remove = async (t: WorkTask) => {
    const ok = await confirm({ title: 'Xoá việc này?', message: `"${t.title}" và toàn bộ bình luận sẽ bị xoá.`, confirmLabel: 'Xoá', variant: 'danger' });
    if (ok) { setOpenId(null); await run(() => deleteTask(t.id)); }
  };

  const quickAdd = async () => {
    if (!quick.trim()) return;
    setSaving(true);
    await run(() => createTask({ ...emptyForm(me), title: quick.trim() }, me));
    setSaving(false);
    setQuick('');
  };

  /** Nhóm theo hạn kiểu To Do; trong nhóm: Gấp trước, rồi hạn gần trước. */
  const today = new Date().toISOString().slice(0, 10);
  const byPriority = (a: WorkTask, b: WorkTask) =>
    Number(b.priority === 'high') - Number(a.priority === 'high') || (a.deadline || '9').localeCompare(b.deadline || '9');
  const pending = visible.filter(t => t.status !== 'done').sort(byPriority);
  const done = visible.filter(t => t.status === 'done');
  const groups = [
    { id: 'overdue', label: 'Quá hạn', tone: 'text-bad', items: pending.filter(t => t.deadline && t.deadline < today) },
    { id: 'today', label: 'Hôm nay', tone: 'text-warn', items: pending.filter(t => t.deadline === today) },
    { id: 'later', label: 'Sắp tới', tone: 'text-faint', items: pending.filter(t => t.deadline > today) },
    { id: 'none', label: 'Không hạn', tone: 'text-faint', items: pending.filter(t => !t.deadline) },
  ];

  /** Việc xong chui vào mục thu gọn nên có thông báo kèm Hoàn tác, trả về đúng trạng thái trước đó. */
  const complete = async (t: WorkTask) => {
    const prev = t.status;
    if (await run(() => setStatus(t.id, 'done'))) {
      toast.success('Đã hoàn thành', t.title, {
        key: `task-done-${t.id}`, duration: 8000,
        confirm: { text: 'Hoàn tác', onConfirm: () => void run(() => setStatus(t.id, prev)) },
      });
    }
  };
  const undoDone = (t: WorkTask) => { toast.dismissKey(`task-done-${t.id}`); void run(() => setStatus(t.id, 'todo')); };
  const row = (t: WorkTask) => (
    <TaskRow key={t.id} task={t} today={today} comments={commentCount[t.id] ?? 0}
      canWork={canWork(t, me)} onComplete={() => void complete(t)} onUndo={() => undoDone(t)} onOpen={() => setOpenId(t.id)} />
  );

  const openTask = tasks.find(t => t.id === openId) ?? null;
  const targets = useMemo(() => targetOptions(me), [me]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Giao việc</h2>
          <p className="text-sm text-soft mt-1">Tạo việc, giao cho TVH hoặc cả khối, theo dõi tới khi xong.</p>
        </div>
        <button onClick={openNew} className="vl-btn vl-btn-primary inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Việc mới
        </button>
      </div>

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'group', label: teamOpen ? `${teamLabel} (${teamOpen})` : teamLabel, icon: Users },
          { id: 'created', label: 'Tôi giao', icon: Send },
          { id: 'all', label: 'Tất cả', icon: ListTodo },
        ]}
      />

      {error && <div className="vl-alert vl-alert-light-danger">{error}</div>}

      {/* Thêm nhanh kiểu To Do: gõ + Enter, đích giao mặc định (TVH mình / cả khối TVH). */}
      <form
        onSubmit={e => { e.preventDefault(); void quickAdd(); }}
        className="flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-surface px-4 py-2 focus-within:ring-2 focus-within:ring-accent"
      >
        <Plus className="w-5 h-5 text-accent shrink-0" />
        <input value={quick} onChange={e => setQuick(e.target.value)} disabled={saving}
          placeholder={`Thêm việc nhanh cho ${targetLabel(emptyForm(me))}… (Enter)`}
          className="flex-1 bg-transparent py-2 text-sm font-semibold text-ink placeholder:text-faint focus:outline-none" />
      </form>

      {loading ? (
        <div className="vl-card"><p className="text-sm text-soft">Đang tải…</p></div>
      ) : visible.length === 0 ? (
        <div className="vl-card"><EmptyState icon={Inbox} title="Chưa có việc nào" hint="Gõ vào ô trên để thêm việc." /></div>
      ) : (
        <div className="vl-card" style={{ padding: 0, overflow: 'hidden' }}>
          {groups.map(g => g.items.length > 0 && (
            <section key={g.id}>
              <p className={`px-5 pt-4 pb-2 text-[11px] font-bold uppercase tracking-widest ${g.tone}`}>
                {g.label} · {g.items.length}
              </p>
              <ul>{g.items.map(row)}</ul>
            </section>
          ))}
          {done.length > 0 && (
            <section className="border-t border-[var(--border)]">
              <button onClick={() => setShowDone(v => !v)}
                className="w-full flex items-center gap-2 px-5 py-3 text-[11px] font-bold uppercase tracking-widest text-faint hover:text-dim">
                <ChevronRight className={`w-4 h-4 transition-transform ${showDone ? 'rotate-90' : ''}`} />
                Đã xong · {done.length}
              </button>
              {showDone && <ul>{done.map(row)}</ul>}
            </section>
          )}
        </div>
      )}

      {openTask && (
        <TaskDetail
          task={openTask}
          me={me}
          onClose={() => setOpenId(null)}
          onEdit={() => { setOpenId(null); openEdit(openTask); }}
          onDelete={() => void remove(openTask)}
          onComplete={() => void complete(openTask)}
          onUndo={() => undoDone(openTask)}
          run={run}
        />
      )}

      <FormModal
        open={!!form}
        title={editingId ? 'Sửa việc' : 'Việc mới'}
        onClose={() => setForm(null)}
        onSubmit={() => void submit()}
        saving={saving}
        submitLabel={editingId ? 'Lưu lại' : 'Giao việc'}
      >
        {form && (
          <div className="space-y-4">
            <Field label="Tiêu đề" required>
              <TextInput value={form.title} onChange={v => setForm({ ...form, title: v })} placeholder="Vd: Kiểm tra công tơ trạm X" />
            </Field>
            <Field label="Mô tả">
              <RichTextEditor value={form.description} onChange={v => setForm({ ...form, description: v })} placeholder="Nội dung cần làm…" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="Giao cho" required>
                  <Select value={targetOf(form)} options={targets}
                    onChange={v => setForm({ ...form, ...applyTarget(v) })} />
                </Field>
              </div>
              <Field label="Hạn hoàn thành">
                <DatePicker value={form.deadline} onChange={v => setForm({ ...form, deadline: v })} usePortal />
              </Field>
              <Field label="Mức ưu tiên">
                <Select value={form.priority} options={PRIORITY_OPTIONS} onChange={v => setForm({ ...form, priority: v as TaskInput['priority'] })} />
              </Field>
            </div>
            <Field label="Checklist">
              <ChecklistEditor items={form.checklist} onChange={c => setForm({ ...form, checklist: c })} />
            </Field>
          </div>
        )}
      </FormModal>
      {dialog}
    </div>
  );
}

/** Nút chốt việc: Hoàn thành khi chưa xong, Hoàn tác khi đã xong. */
function CompleteButton({ done, onComplete, onUndo }: { done: boolean; onComplete: () => void; onUndo: () => void }) {
  return done ? (
    <button type="button" onClick={onUndo} className="vl-btn vl-btn-secondary vl-btn-sm inline-flex items-center gap-1 shrink-0">
      <Undo2 className="w-4 h-4" /> Hoàn tác
    </button>
  ) : (
    <button type="button" onClick={onComplete} className="vl-btn vl-btn-success vl-btn-sm inline-flex items-center gap-1 shrink-0">
      <Check className="w-4 h-4" /> Hoàn thành
    </button>
  );
}

/** Một dòng việc kiểu Todoist / To Do: biểu tượng trạng thái, tiêu đề, dòng chip phụ, nút chốt việc. */
function TaskRow({ task: t, today, comments, canWork: work, onComplete, onUndo, onOpen }: {
  task: WorkTask; today: string; comments: number; canWork: boolean; onComplete: () => void; onUndo: () => void; onOpen: () => void;
}) {
  const isDone = t.status === 'done';
  const checked = t.checklist.filter(c => c.done).length;
  const overdue = isOverdue(t, today);
  const dueTone = isDone ? 'text-faint' : overdue ? 'text-bad font-bold' : t.deadline === today ? 'text-warn font-bold' : 'text-soft';
  const StatusIcon = isDone ? CheckCircle2 : t.status === 'doing' ? CircleDot : Circle;
  return (
    <li className="group flex items-start gap-3 px-5 py-3 border-t border-[var(--border)] first:border-t-0 hover:bg-subtle transition-colors">
      <span title={STATUS_LABEL[t.status]} className={`mt-0.5 shrink-0 ${
        isDone ? 'text-good' : t.priority === 'high' ? 'text-bad' : t.status === 'doing' ? 'text-accent' : 'text-faint'
      }`}>
        <StatusIcon className="w-5 h-5" />
      </span>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <p className={`text-sm font-semibold ${isDone ? 'line-through text-faint' : 'text-ink'}`}>{t.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-soft">
          <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{targetLabel(t)}</span>
          {t.status === 'doing' && <span className="text-accent font-bold">{STATUS_LABEL.doing}</span>}
          {t.deadline && (
            <span className={`inline-flex items-center gap-1 ${dueTone}`}>
              {overdue ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
              {t.deadline === today ? 'Hôm nay' : fmtDay(t.deadline)}
            </span>
          )}
          {t.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1"><CheckSquare className="w-3 h-3" />{checked}/{t.checklist.length}</span>
          )}
          {comments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="w-3 h-3" />{comments}</span>}
        </p>
      </button>
      {t.priority === 'high' && !isDone && <Flag className="w-4 h-4 mt-0.5 shrink-0 text-bad fill-current" aria-label="Gấp" />}
      {work && <CompleteButton done={isDone} onComplete={onComplete} onUndo={onUndo} />}
    </li>
  );
}

function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (c: ChecklistItem[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { if (draft.trim()) { onChange([...items, { text: draft.trim(), done: false }]); setDraft(''); } };
  return (
    <div className="space-y-2">
      {items.map((c, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={c.text} className={INPUT_CLS}
            onChange={e => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="p-2 text-faint hover:text-bad" title="Bỏ bước này">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input value={draft} placeholder="Thêm bước…" className={INPUT_CLS}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="vl-btn vl-btn-secondary vl-btn-sm"><Plus className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function TaskDetail({ task: t, me, onClose, onEdit, onDelete, onComplete, onUndo, run }: {
  task: WorkTask; me: ReturnType<typeof currentUser>;
  onClose: () => void; onEdit: () => void; onDelete: () => void; onComplete: () => void; onUndo: () => void;
  run: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [body, setBody] = useState('');
  const work = canWork(t, me);
  const owner = canEdit(t, me);
  const { confirm, dialog } = useConfirm();
  const chatEnd = useRef<HTMLDivElement>(null);

  const loadComments = useCallback(() => { void listComments(t.id).then(setComments).catch(() => setComments([])); }, [t.id]);
  useEffect(loadComments, [loadComments]);
  // Tin mới nhất ở dưới cùng như khung nhắn tin.
  useEffect(() => { chatEnd.current?.parentElement?.scrollTo({ top: chatEnd.current.offsetTop }); }, [comments.length]);

  const toggle = (i: number) =>
    void run(() => setChecklist(t.id, t.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c))));

  const send = async () => {
    if (!body.trim()) return;
    await run(() => addComment(t.id, body.trim(), me));
    setBody('');
    loadComments();
  };

  const recall = async (c: TaskComment) => {
    const ok = await confirm({ title: 'Thu hồi tin nhắn?', message: 'Nội dung sẽ bị xoá với mọi người và không khôi phục được.', confirmLabel: 'Thu hồi', variant: 'danger' });
    if (ok) { await run(() => recallComment(c.id)); loadComments(); }
  };

  return (
    <>
    <FormModal open title={t.title} onClose={onClose} onSubmit={onClose} submitLabel="Đóng">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
          <span>Giao bởi <b className="text-dim">{t.created_by_name || '—'}</b> · {fmtTime(t.created)}</span>
          <span>→ <b className="text-dim">{targetLabel(t)}</b></span>
          {t.deadline && <span className={isOverdue(t) ? 'text-bad font-bold' : ''}>· Hạn {fmtDay(t.deadline)}</span>}
        </div>

        {t.description && <RichTextView value={t.description} className="text-sm text-dim" />}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Trạng thái">
              <Select value={t.status} options={STATUS_OPTIONS} disabled={!work}
                onChange={v => void run(() => setStatus(t.id, v as TaskStatus))} />
            </Field>
          </div>
          {work && <CompleteButton done={t.status === 'done'} onComplete={onComplete} onUndo={onUndo} />}
          {owner && (
            <>
              <button type="button" onClick={onEdit} className="vl-btn vl-btn-secondary vl-btn-sm inline-flex items-center gap-1"><Pencil className="w-4 h-4" /> Sửa</button>
              <button type="button" onClick={onDelete} className="vl-btn vl-btn-danger vl-btn-sm inline-flex items-center gap-1"><Trash2 className="w-4 h-4" /> Xoá</button>
            </>
          )}
        </div>

        {t.checklist.length > 0 && (
          <div>
            <p className="ml-1 mb-2 text-[10px] font-bold uppercase text-faint">Checklist</p>
            <ul className="space-y-1">
              {t.checklist.map((c, i) => (
                <li key={i}>
                  <button type="button" disabled={!work} onClick={() => toggle(i)}
                    className="flex items-center gap-2 text-sm text-left disabled:cursor-not-allowed">
                    {c.done ? <CheckSquare className="w-4 h-4 text-good" /> : <Square className="w-4 h-4 text-faint" />}
                    <span className={c.done ? 'line-through text-faint' : 'text-dim'}>{c.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="ml-1 mb-2 text-[10px] font-bold uppercase text-faint">Bình luận ({comments.filter(c => !c.recalled).length})</p>
          {comments.length > 0 && (
            <div className="vl-chat mb-3">
              {comments.map((c, i) => {
                const mine = c.author === me.id;
                const followUp = comments[i - 1]?.author === c.author;
                return (
                  <div key={c.id} className={`vl-chat-row ${mine ? 'vl-chat-mine' : ''} ${followUp ? 'vl-chat-follow' : ''}`}>
                    {!mine && !followUp && <p className="vl-chat-name">{c.author_name || '—'}</p>}
                    <div className="vl-chat-line">
                      <p className={`vl-chat-bubble ${c.recalled ? 'vl-chat-recalled' : ''}`}>
                        {c.recalled ? (mine ? 'Bạn đã thu hồi một tin nhắn' : 'Tin nhắn đã được thu hồi') : c.body}
                      </p>
                      {mine && !c.recalled && (
                        <button type="button" onClick={() => void recall(c)} title="Thu hồi tin nhắn" aria-label="Thu hồi tin nhắn" className="vl-chat-recall">
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="vl-chat-time">{fmtTime(c.created)}</p>
                  </div>
                );
              })}
              <div ref={chatEnd} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input value={body} placeholder="Viết bình luận…" className={INPUT_CLS}
              onChange={e => setBody(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} />
            <button type="button" onClick={() => void send()} className="vl-btn vl-btn-primary vl-btn-sm"><Send className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </FormModal>
    {dialog}
    </>
  );
}
