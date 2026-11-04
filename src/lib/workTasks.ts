/**
 * "Giao việc" — nhiệm vụ giao tay kiểu To Do / Planner (plan 2026-11-02-viec-can-lam-giao-viec.md).
 * Collection `work_tasks` + `work_task_comments` (scripts/work_tasks_schema.mjs).
 *
 * Quyền (user chốt 02/11/2026): người tạo sửa/xoá; người được giao — hoặc cả nhóm khi chưa
 * chỉ định người — đổi trạng thái, tick checklist, bình luận. PB chỉ chặn được XOÁ (nhóm có
 * thể suy từ `area`), phần còn lại chặn ở UI qua `canWork` / `canEdit`.
 *
 * Đích giao (user chốt 02/11/2026, bỏ ô tên người 04/11/2026): cả khối (`assignee_group`) hoặc
 * một TVH (`assignee_area` = KCN, đúng giá trị `users.area`); `assignee_name` chỉ còn ở việc cũ.
 * Mỗi TVH chỉ có MỘT tài khoản dùng chung nên không chọn tài khoản cá nhân. TVH giao trong TVH mình;
 * Kinh Doanh giao cả khối TVH / một TVH. `description` là HTML đã lọc (lib/richText.ts); việc cũ có
 * thể là chữ thường.
 *
 * Tên người lưu kèm dạng text (`*_name`) vì `users.listRule` chỉ cho xem người cùng area.
 */
import { pb, ID_TO_AREA } from './pocketbase';
import { userGroupOf, GROUP_LABEL, type UserGroup } from './userGroup';

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'normal' | 'high';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Chưa làm',
  doing: 'Đang làm',
  done: 'Xong',
};

/** Khớp `work_tasks.description.max` (scripts/work_tasks_schema.mjs). */
export const DESCRIPTION_MAX = 20000;

export interface ChecklistItem { text: string; done: boolean }

export interface WorkTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_group: UserGroup;
  assignee_area: string;
  assignee: string;
  assignee_name: string;
  deadline: string;          // 'YYYY-MM-DD' hoặc ''
  checklist: ChecklistItem[];
  created_by: string;
  created_by_name: string;
  done_at: string;
  created: string;
  updated: string;
}

export interface TaskComment {
  id: string;
  task: string;
  author: string;
  author_name: string;
  body: string;
  created: string;
}

export interface Me { id: string; name: string; group: UserGroup; areas: string[] }

/** KCN (= TVH) của một user — `users.area` là select tên đầy đủ, có thể nhiều giá trị. */
function areasOf(r: Record<string, any> | null | undefined): string[] {
  const raw = r?.area;
  const items: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];
  return items.map(a => ID_TO_AREA[a] || a);
}

export function currentUser(): Me {
  const m = pb.authStore.model;
  return { id: m?.id ?? '', name: m?.name || m?.username || 'Người dùng', group: userGroupOf(m), areas: areasOf(m) };
}

const TASKS = 'work_tasks';
const COMMENTS = 'work_task_comments';

/** PB trả date dạng 'YYYY-MM-DD hh:mm:ss.sssZ'; màn chỉ cần phần ngày. */
const dayOf = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '');

function toTask(r: Record<string, any>): WorkTask {
  return {
    id: r.id,
    title: r.title ?? '',
    description: r.description ?? '',
    status: (r.status || 'todo') as TaskStatus,
    priority: (r.priority || 'normal') as TaskPriority,
    assignee_group: r.assignee_group,
    assignee_area: r.assignee_area ?? '',
    assignee: r.assignee ?? '',
    assignee_name: r.assignee_name ?? '',
    deadline: dayOf(r.deadline),
    checklist: Array.isArray(r.checklist) ? r.checklist : [],
    created_by: r.created_by ?? '',
    created_by_name: r.created_by_name ?? '',
    done_at: r.done_at ?? '',
    created: r.created ?? '',
    updated: r.updated ?? '',
  };
}

export async function listTasks(): Promise<WorkTask[]> {
  const rows = await pb.collection(TASKS).getFullList({ sort: '-created', requestKey: null });
  return rows.map(toTask);
}

export interface TaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  assignee_group: UserGroup;
  assignee_area: string;
  assignee: string;
  assignee_name: string;
  deadline: string;
  checklist: ChecklistItem[];
}

/** PB lưu date theo UTC — ghi giữa trưa để múi giờ VN không đẩy lùi sang hôm trước. */
const dateField = (d: string) => (d ? `${d} 12:00:00.000Z` : '');

export async function createTask(input: TaskInput, me: Me) {
  await pb.collection(TASKS).create({
    ...input,
    deadline: dateField(input.deadline),
    status: 'todo',
    created_by: me.id,
    created_by_name: me.name,
  });
}

export async function updateTask(id: string, patch: Partial<TaskInput>) {
  const body: Record<string, unknown> = { ...patch };
  if (patch.deadline !== undefined) body.deadline = dateField(patch.deadline);
  await pb.collection(TASKS).update(id, body);
}

export async function setStatus(id: string, status: TaskStatus) {
  await pb.collection(TASKS).update(id, { status, done_at: status === 'done' ? new Date().toISOString() : '' });
}

export async function setChecklist(id: string, checklist: ChecklistItem[]) {
  await pb.collection(TASKS).update(id, { checklist });
}

export async function deleteTask(id: string) {
  await pb.collection(TASKS).delete(id);
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  const rows = await pb.collection(COMMENTS).getFullList({
    filter: pb.filter('task = {:t}', { t: taskId }), sort: 'created', requestKey: null,
  });
  return rows.map(r => ({ id: r.id, task: r.task, author: r.author, author_name: r.author_name ?? '', body: r.body, created: r.created }));
}

export async function addComment(taskId: string, body: string, me: Me) {
  await pb.collection(COMMENTS).create({ task: taskId, author: me.id, author_name: me.name, body });
}

export const canEdit = (t: WorkTask, me: Me) => t.created_by === me.id;
/** Việc giao cho khối/TVH của mình (không tính việc giao đích danh người khác). */
export const isForMyTeam = (t: WorkTask, me: Me) =>
  t.assignee_group === me.group && (!t.assignee_area || me.areas.includes(t.assignee_area));
export const isForMe = (t: WorkTask, me: Me) => t.assignee === me.id || (!t.assignee && isForMyTeam(t, me));
export const canWork = (t: WorkTask, me: Me) => canEdit(t, me) || isForMe(t, me);

/** Nhãn đích giao: tên người / TVH / cả khối. */
export const targetLabel = (t: Pick<WorkTask, 'assignee_name' | 'assignee_area' | 'assignee_group'>) =>
  [t.assignee_name, t.assignee_area ? `TVH ${t.assignee_area}` : t.assignee_group === 'van_hanh' ? 'Cả khối TVH' : GROUP_LABEL[t.assignee_group]]
    .filter(Boolean).join(' · ');

export function isOverdue(t: WorkTask, today = new Date().toISOString().slice(0, 10)) {
  return t.status !== 'done' && !!t.deadline && t.deadline < today;
}

/** Số bình luận theo việc — chỉ đọc trường `task` để nhẹ. */
export async function commentCounts(): Promise<Record<string, number>> {
  const rows = await pb.collection(COMMENTS).getFullList({ fields: 'task', requestKey: null });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.task] = (out[r.task] ?? 0) + 1;
  return out;
}
