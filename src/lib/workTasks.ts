/**
 * "Giao việc" — nhiệm vụ giao tay kiểu To Do / Planner (plan 2026-11-02-viec-can-lam-giao-viec.md).
 * Collection `work_tasks` + `work_task_comments` (scripts/work_tasks_schema.mjs).
 *
 * Quyền (user chốt 02/11/2026): người tạo sửa/xoá; người được giao — hoặc cả nhóm khi chưa
 * chỉ định người — đổi trạng thái, tick checklist, bình luận. PB chỉ chặn được XOÁ (nhóm có
 * thể suy từ `area`), phần còn lại chặn ở UI qua `canWork` / `canEdit`.
 *
 * Tên người lưu kèm dạng text (`*_name`) vì `users.listRule` chỉ cho xem người cùng area.
 */
import { pb } from './pocketbase';
import { userGroupOf, type UserGroup } from './userGroup';

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'normal' | 'high';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Chưa làm',
  doing: 'Đang làm',
  done: 'Xong',
};

export interface ChecklistItem { text: string; done: boolean }

export interface WorkTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_group: UserGroup;
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

export interface Me { id: string; name: string; group: UserGroup }

export function currentUser(): Me {
  const m = pb.authStore.model;
  return { id: m?.id ?? '', name: m?.name || m?.username || 'Người dùng', group: userGroupOf(m) };
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

/** Người trong nhóm tự nhận việc chưa chỉ định người. */
export async function claimTask(id: string, me: Me) {
  await pb.collection(TASKS).update(id, { assignee: me.id, assignee_name: me.name });
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

/** Người dùng chọn được để giao — chỉ những ai `users.listRule` cho xem (cùng area). */
export async function listAssignableUsers(): Promise<{ id: string; name: string; group: UserGroup }[]> {
  try {
    const rows = await pb.collection('users').getFullList({ sort: 'name', requestKey: null });
    return rows.map(r => ({ id: r.id, name: r.name || r.username || r.id, group: userGroupOf(r) }));
  } catch {
    return [];
  }
}

export const canEdit = (t: WorkTask, me: Me) => t.created_by === me.id;
export const canWork = (t: WorkTask, me: Me) =>
  canEdit(t, me) || t.assignee === me.id || (!t.assignee && t.assignee_group === me.group);

export function isOverdue(t: WorkTask, today = new Date().toISOString().slice(0, 10)) {
  return t.status !== 'done' && !!t.deadline && t.deadline < today;
}
