#!/usr/bin/env node
/**
 * Schema "Giao việc" (plan 2026-11-02-viec-can-lam-giao-viec.md) — CHỈ TẠO 2 collection mới:
 *  - `work_tasks`          nhiệm vụ giao tay: tiêu đề, mô tả, nhóm/người được giao, hạn, checklist (json)
 *  - `work_task_comments`  bình luận của nhiệm vụ (xoá nhiệm vụ ⇒ xoá theo)
 *
 * Quyền: đăng nhập là xem/tạo/cập nhật được (ai được đổi gì do UI chặn — nhóm của user
 * có thể suy từ `area` nên rule PB không biểu diễn được); XOÁ chỉ người tạo.
 *
 * Mặc định dry-run. 9 collection bảo vệ phải không đổi.
 *   railway run -- node scripts/work_tasks_schema.mjs [--apply]
 * ⚠️ staging và production DÙNG CHUNG một PocketBase.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const APPLY = process.argv.includes('--apply');
const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

const email = process.env.PB_EMAIL || process.env.PB_ADMIN_EMAIL;
const password = process.env.PB_PASS || process.env.PB_ADMIN_PASSWORD;
if (!email || !password) { console.error('Thiếu tài khoản PocketBase. Chạy qua `railway run`.'); process.exit(1); }

const curl = (args) => {
  const out = execFileSync('curl', ['-s', '-m', '60', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { console.error('Phản hồi không phải JSON:', out.slice(0, 300)); process.exit(1); }
};
const send = (method, path, body) => {
  const f = join(mkdtempSync(join(tmpdir(), 'wtask-')), 'body.json');
  fs.writeFileSync(f, JSON.stringify(body));
  try { return curl(['-X', method, `${PB}${path}`, '-H', 'Content-Type: application/json', ...H, '--data-binary', `@${f}`]); }
  finally { rmSync(f, { force: true }); }
};

/* Đăng nhập: mật khẩu đi qua FILE tạm, không qua dòng lệnh. */
let H = [];
const auth = send('POST', '/api/collections/_superusers/auth-with-password', { identity: email, password });
if (!auth?.token) { console.error('Đăng nhập PocketBase thất bại:', JSON.stringify(auth).slice(0, 200)); process.exit(1); }
H = ['-H', `Authorization: ${auth.token}`];

const listCols = () => curl([`${PB}/api/collections?perPage=500`, ...H]).items || [];
const snap = cols => JSON.stringify(PROTECTED.map(n => cols.find(c => c.name === n) ?? null).map(c => c && { ...c, updated: undefined }));

let cols = listCols();
const before = snap(cols);
const users = cols.find(c => c.name === 'users');
if (!users) { console.error('Không thấy collection users'); process.exit(1); }
console.log(`\nPB: ${PB}\nusers.listRule = ${JSON.stringify(users.listRule)} (màn Giao việc cần liệt kê user để chọn người)`);

const AUTH = '@request.auth.id != ""';
const userRel = (name, required = false) => ({ name, type: 'relation', required, collectionId: users.id, maxSelect: 1, cascadeDelete: false });
const autodate = [
  { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
  { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
];

const DESC_MAX = 20000; // description lưu HTML richtext (nâng từ 5000 ngày 04/11/2026)
/* Thu hồi bình luận (04/11/2026): người gửi tự đánh dấu, không được đổi task/author. */
const RECALLED_FIELD = { name: 'recalled', type: 'bool' };
const COMMENT_UPDATE_RULE = 'author = @request.auth.id && @request.body.task:isset = false && @request.body.author:isset = false';
const AREA_FIELD = { name: 'assignee_area', type: 'text', max: 100 };
const TASKS = {
  name: 'work_tasks', type: 'base',
  listRule: AUTH, viewRule: AUTH,
  createRule: `${AUTH} && created_by = @request.auth.id`,
  updateRule: AUTH,
  deleteRule: 'created_by = @request.auth.id',
  fields: [
    { name: 'title', type: 'text', required: true, max: 300 },
    { name: 'description', type: 'text', max: DESC_MAX },
    { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['todo', 'doing', 'done'] },
    { name: 'priority', type: 'select', maxSelect: 1, values: ['normal', 'high'] },
    { name: 'assignee_group', type: 'select', required: true, maxSelect: 1, values: ['van_hanh', 'kinh_doanh', 'vat_tu'] },
    userRel('assignee'),
    // Tên chụp lại lúc ghi: users.listRule chỉ cho xem người cùng area nên expand không đủ.
    { name: 'assignee_name', type: 'text', max: 200 },
    // TVH (KCN, đúng giá trị users.area) được giao; trống = cả khối assignee_group (thêm 02/11/2026).
    AREA_FIELD,
    { name: 'deadline', type: 'date' },
    { name: 'checklist', type: 'json', maxSize: 200000 },
    userRel('created_by', true),
    { name: 'created_by_name', type: 'text', max: 200 },
    { name: 'done_at', type: 'date' },
    ...autodate,
  ],
};

let tasksCol = cols.find(c => c.name === 'work_tasks');
const hasComments = cols.some(c => c.name === 'work_task_comments');
console.log(tasksCol ? '= Đã có work_tasks' : 'SẼ TẠO work_tasks');
console.log(hasComments ? '= Đã có work_task_comments' : 'SẼ TẠO work_task_comments');
const needArea = tasksCol && !tasksCol.fields.some(f => f.name === AREA_FIELD.name);
if (needArea) console.log('SẼ THÊM work_tasks.assignee_area');
const needDescMax = tasksCol && tasksCol.fields.find(f => f.name === 'description')?.max !== DESC_MAX;
if (needDescMax) console.log(`SẼ NÂNG work_tasks.description.max → ${DESC_MAX}`);
let commentsCol = cols.find(c => c.name === 'work_task_comments');
const needRecall = commentsCol && (!commentsCol.fields.some(f => f.name === RECALLED_FIELD.name) || commentsCol.updateRule !== COMMENT_UPDATE_RULE);
if (needRecall) console.log('SẼ THÊM work_task_comments.recalled + updateRule cho người gửi');
if (tasksCol && hasComments && !needArea && !needDescMax && !needRecall) process.exit(0);
if (!APPLY) { console.log('\n[XEM TRƯỚC] Chưa ghi gì. Thêm --apply để ghi thật.\n'); process.exit(0); }

if (!tasksCol) {
  tasksCol = send('POST', '/api/collections', TASKS);
  if (!tasksCol?.id) { console.error('Tạo work_tasks thất bại:', JSON.stringify(tasksCol).slice(0, 500)); process.exit(1); }
  console.log('OK — tạo work_tasks');
}
if (needArea) {
  /* PATCH phải gửi đủ trường cũ (kèm id) — thiếu trường nào PB xoá trường đó. */
  const res = send('PATCH', `/api/collections/${tasksCol.id}`, { fields: [...tasksCol.fields, AREA_FIELD] });
  if (!(res.fields ?? []).some(f => f.name === AREA_FIELD.name)) { console.error('Thêm assignee_area thất bại:', JSON.stringify(res).slice(0, 400)); process.exit(1); }
  console.log('OK — thêm work_tasks.assignee_area');
}
if (needDescMax) {
  const res = send('PATCH', `/api/collections/${tasksCol.id}`, {
    fields: (tasksCol.fields).map(f => (f.name === 'description' ? { ...f, max: DESC_MAX } : f)),
  });
  if (res.fields?.find(f => f.name === 'description')?.max !== DESC_MAX) { console.error('Nâng description.max thất bại:', JSON.stringify(res).slice(0, 400)); process.exit(1); }
  console.log('OK — nâng work_tasks.description.max');
}
if (needRecall) {
  const fields = commentsCol.fields.some(f => f.name === RECALLED_FIELD.name) ? commentsCol.fields : [...commentsCol.fields, RECALLED_FIELD];
  const res = send('PATCH', `/api/collections/${commentsCol.id}`, { fields, updateRule: COMMENT_UPDATE_RULE });
  if (res.updateRule !== COMMENT_UPDATE_RULE || !res.fields?.some(f => f.name === RECALLED_FIELD.name)) { console.error('Thêm thu hồi thất bại:', JSON.stringify(res).slice(0, 400)); process.exit(1); }
  console.log('OK — thêm thu hồi bình luận');
}
if (!hasComments) {
  const res = send('POST', '/api/collections', {
    name: 'work_task_comments', type: 'base',
    listRule: AUTH, viewRule: AUTH,
    createRule: `${AUTH} && author = @request.auth.id`,
    updateRule: COMMENT_UPDATE_RULE,
    deleteRule: 'author = @request.auth.id',
    fields: [
      { name: 'task', type: 'relation', required: true, collectionId: tasksCol.id, maxSelect: 1, cascadeDelete: true },
      userRel('author', true),
      { name: 'author_name', type: 'text', max: 200 },
      { name: 'body', type: 'text', required: true, max: 3000 },
      RECALLED_FIELD,
      ...autodate,
    ],
  });
  if (!res?.id) { console.error('Tạo work_task_comments thất bại:', JSON.stringify(res).slice(0, 500)); process.exit(1); }
  console.log('OK — tạo work_task_comments');
}
cols = listCols();
if (snap(cols) !== before) { console.error('\n⚠️  Collection bảo vệ BỊ THAY ĐỔI!'); process.exit(1); }
console.log('\nKiểm lại: chỉ thêm 2 collection mới; collection bảo vệ không đổi.');
