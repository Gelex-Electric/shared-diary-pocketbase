/**
 * Màn "Giao việc" — nhiệm vụ giao tay giữa các nhóm (plan 2026-11-02-viec-can-lam-giao-viec.md).
 * Một danh sách chung cho cả 3 nhóm; ba cột Chưa làm / Đang làm / Xong. Bấm thẻ để mở
 * chi tiết: checklist con + bình luận. Quyền xem `lib/workTasks.ts` (canEdit / canWork).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListTodo, Plus, User, Users, Inbox, CalendarClock, Pencil, Trash2, Send, CheckSquare, Square, X,
  Hand, AlertTriangle,
} from 'lucide-react';
import { Tabs } from '../ui/Tabs';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/dashboard';
import { FormModal, Field, TextInput, INPUT_CLS } from '../dm/entryUi';
import { GROUP_LABEL, type UserGroup } from '../../lib/userGroup';
import {
  STATUS_LABEL, currentUser, listTasks, createTask, updateTask, setStatus, setChecklist, claimTask,
  deleteTask, listComments, addComment, listAssignableUsers, canEdit, canWork, isOverdue,
  type WorkTask, type TaskStatus, type TaskInput, type TaskComment, type ChecklistItem,
} from '../../lib/workTasks';

type Filter = 'mine' | 'group' | 'created' | 'all';
const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];
const GROUP_OPTIONS = (Object.keys(GROUP_LABEL) as UserGroup[]).map(g => ({ value: g, label: GROUP_LABEL[g] }));
const PRIORITY_OPTIONS = [{ value: 'normal', label: 'Thường' }, { value: 'high', label: 'Gấp' }];
const STATUS_OPTIONS = STATUSES.map(s => ({ value: s, label: STATUS_LABEL[s] }));

const fmtDay = (d: string) => (d ? d.split('-').reverse().join('/') : '');
const fmtTime = (iso: string) => {
  const d = new Date(iso.replace(' ', 'T'));
  return isNaN(+d) ? '' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const EMPTY_FORM: TaskInput = {
  title: '', description: '', priority: 'normal', assignee_group: 'van_hanh',
  assignee: '', assignee_name: '', deadline: '', checklist: [],
};

export default function WorkTasks() {
  const me = useMemo(currentUser, []);
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('mine');
  const [people, setPeople] = useState<{ id: string; name: string; group: UserGroup }[]>([]);
  const [form, setForm] = useState<TaskInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const reload = useCallback(async () => {
    try {
      setTasks(await listTasks());
      setError('');
    } catch (e) {
      setError(`Không tải được danh sách việc: ${errMsg(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); void listAssignableUsers().then(setPeople); }, [reload]);

  /** Chạy một thao tác ghi rồi nạp lại; lỗi hiện ở thanh đỏ đầu màn. */
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await reload(); } catch (e) { setError(errMsg(e)); }
  };

  const visible = tasks.filter(t =>
    filter === 'all' ? true
    : filter === 'created' ? t.created_by === me.id
    : filter === 'group' ? t.assignee_group === me.group
    : t.assignee === me.id || (!t.assignee && t.assignee_group === me.group));

  const mineOpen = tasks.filter(t => t.status !== 'done' && (t.assignee === me.id || (!t.assignee && t.assignee_group === me.group))).length;

  const openNew = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); };
  const openEdit = (t: WorkTask) => {
    setEditingId(t.id);
    setForm({
      title: t.title, description: t.description, priority: t.priority, assignee_group: t.assignee_group,
      assignee: t.assignee, assignee_name: t.assignee_name, deadline: t.deadline, checklist: t.checklist,
    });
  };

  const submit = async () => {
    if (!form || !form.title.trim()) { setError('Nhập tiêu đề việc.'); return; }
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

  const openTask = tasks.find(t => t.id === openId) ?? null;
  const groupPeople = people.filter(p => form && p.group === form.assignee_group);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-ink">Giao việc</h2>
          <p className="text-sm text-soft mt-1">Tạo việc, giao cho nhóm hoặc một người, theo dõi tới khi xong.</p>
        </div>
        <button onClick={openNew} className="vl-btn vl-btn-primary inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Việc mới
        </button>
      </div>

      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: 'mine', label: mineOpen ? `Việc của tôi (${mineOpen})` : 'Việc của tôi', icon: User },
          { id: 'group', label: GROUP_LABEL[me.group], icon: Users },
          { id: 'created', label: 'Tôi giao', icon: Send },
          { id: 'all', label: 'Tất cả', icon: ListTodo },
        ]}
      />

      {error && <div className="vl-alert vl-alert-light-danger">{error}</div>}

      {loading ? (
        <div className="vl-card"><p className="text-sm text-soft">Đang tải…</p></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {STATUSES.map(s => {
            const col = visible.filter(t => t.status === s);
            return (
              <div key={s} className="vl-card" style={{ padding: '1rem' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="vl-section-title" style={{ margin: 0 }}>{STATUS_LABEL[s]}</p>
                  <span className="text-xs font-bold text-faint">{col.length}</span>
                </div>
                {col.length === 0 ? (
                  <EmptyState icon={Inbox} title="Không có việc" />
                ) : (
                  <ul className="space-y-2">
                    {col.map(t => <TaskCard key={t.id} task={t} onOpen={() => setOpenId(t.id)} />)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openTask && (
        <TaskDetail
          task={openTask}
          me={me}
          onClose={() => setOpenId(null)}
          onEdit={() => { setOpenId(null); openEdit(openTask); }}
          onDelete={() => void remove(openTask)}
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
              <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={INPUT_CLS} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Giao cho nhóm" required>
                <Select value={form.assignee_group} options={GROUP_OPTIONS}
                  onChange={v => setForm({ ...form, assignee_group: v as UserGroup, assignee: '', assignee_name: '' })} />
              </Field>
              <Field label="Người cụ thể" hint={groupPeople.length ? undefined : 'Chỉ chọn được người cùng khu vực — để trống thì ai trong nhóm cũng nhận được.'}>
                <Select value={form.assignee}
                  options={[{ value: '', label: '— Cả nhóm —' }, ...groupPeople.map(p => ({ value: p.id, label: p.name }))]}
                  onChange={v => setForm({ ...form, assignee: v, assignee_name: people.find(p => p.id === v)?.name ?? '' })} />
              </Field>
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

function TaskCard({ task: t, onOpen }: { task: WorkTask; onOpen: () => void }) {
  const done = t.checklist.filter(c => c.done).length;
  const overdue = isOverdue(t);
  return (
    <li>
      <button onClick={onOpen}
        className="w-full text-left rounded-[var(--radius-sm)] border border-[var(--border)] bg-surface hover:bg-subtle p-3 transition-colors">
        <div className="flex items-start gap-2">
          <p className={`flex-1 text-sm font-semibold ${t.status === 'done' ? 'line-through text-faint' : 'text-ink'}`}>{t.title}</p>
          {t.priority === 'high' && t.status !== 'done' && (
            <span className="vl-badge-danger px-2 py-0.5 rounded-md text-[11px] font-bold shrink-0">Gấp</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-soft">
          <span className="inline-flex items-center gap-1">
            {t.assignee ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />}
            {t.assignee_name || GROUP_LABEL[t.assignee_group]}
          </span>
          {t.deadline && (
            <span className={`inline-flex items-center gap-1 ${overdue ? 'text-bad font-bold' : ''}`}>
              {overdue ? <AlertTriangle className="w-3 h-3" /> : <CalendarClock className="w-3 h-3" />}
              {fmtDay(t.deadline)}
            </span>
          )}
          {t.checklist.length > 0 && (
            <span className="inline-flex items-center gap-1"><CheckSquare className="w-3 h-3" />{done}/{t.checklist.length}</span>
          )}
        </div>
      </button>
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

function TaskDetail({ task: t, me, onClose, onEdit, onDelete, run }: {
  task: WorkTask; me: ReturnType<typeof currentUser>;
  onClose: () => void; onEdit: () => void; onDelete: () => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [body, setBody] = useState('');
  const work = canWork(t, me);
  const owner = canEdit(t, me);

  const loadComments = useCallback(() => { void listComments(t.id).then(setComments).catch(() => setComments([])); }, [t.id]);
  useEffect(loadComments, [loadComments]);

  const toggle = (i: number) =>
    void run(() => setChecklist(t.id, t.checklist.map((c, j) => (j === i ? { ...c, done: !c.done } : c))));

  const send = async () => {
    if (!body.trim()) return;
    await run(() => addComment(t.id, body.trim(), me));
    setBody('');
    loadComments();
  };

  return (
    <FormModal open title={t.title} onClose={onClose} onSubmit={onClose} submitLabel="Đóng">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-soft">
          <span>Giao bởi <b className="text-dim">{t.created_by_name || '—'}</b> · {fmtTime(t.created)}</span>
          <span>→ <b className="text-dim">{t.assignee_name || GROUP_LABEL[t.assignee_group]}</b>
            {t.assignee_name && <> ({GROUP_LABEL[t.assignee_group]})</>}</span>
          {t.deadline && <span className={isOverdue(t) ? 'text-bad font-bold' : ''}>· Hạn {fmtDay(t.deadline)}</span>}
        </div>

        {t.description && <p className="text-sm text-dim whitespace-pre-wrap">{t.description}</p>}

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field label="Trạng thái">
              <Select value={t.status} options={STATUS_OPTIONS} disabled={!work}
                onChange={v => void run(() => setStatus(t.id, v as TaskStatus))} />
            </Field>
          </div>
          {!t.assignee && t.status !== 'done' && t.assignee_group === me.group && (
            <button type="button" onClick={() => void run(() => claimTask(t.id, me))} className="vl-btn vl-btn-outline-primary vl-btn-sm inline-flex items-center gap-1">
              <Hand className="w-4 h-4" /> Nhận việc
            </button>
          )}
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
          <p className="ml-1 mb-2 text-[10px] font-bold uppercase text-faint">Bình luận ({comments.length})</p>
          <ul className="space-y-2 mb-3">
            {comments.map(c => (
              <li key={c.id} className="rounded-[var(--radius-sm)] bg-subtle px-3 py-2">
                <p className="text-[11px] text-soft"><b className="text-dim">{c.author_name || '—'}</b> · {fmtTime(c.created)}</p>
                <p className="text-sm text-dim whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <input value={body} placeholder="Viết bình luận…" className={INPUT_CLS}
              onChange={e => setBody(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }} />
            <button type="button" onClick={() => void send()} className="vl-btn vl-btn-primary vl-btn-sm"><Send className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </FormModal>
  );
}
