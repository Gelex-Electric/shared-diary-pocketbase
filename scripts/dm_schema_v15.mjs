#!/usr/bin/env node
/**
 * Schema đợt 15 — thêm `dm_customer.low_name` (tên khách viết thường).
 *
 * Vì sao: PocketBase (SQLite) so sánh `~` có phân biệt hoa/thường với ký tự
 * tiếng Việt có dấu, nên lọc/tìm theo tên phải tự hạ chữ ở client. Có sẵn một
 * cột đã viết thường thì lọc phía server (`low_name ~ "..."`) và sắp xếp
 * mới cho kết quả đúng.
 *
 * Script làm 2 việc:
 *   1. Thêm trường `low_name` (text, không bắt buộc) vào `dm_customer`.
 *   2. Backfill: với mọi bản ghi, ghi `low_name = name.toLowerCase()`
 *      (GIỮ DẤU tiếng Việt, chỉ hạ hoa→thường). Chỉ ghi khi khác giá trị cũ.
 *
 * KHÔNG chạm 9 collection có sẵn, không sửa trường nào khác của dm_customer.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v15.mjs --dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v15.mjs
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');

const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

async function call(method, path, token, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`HTTP ${res.status} ${method} ${path}\n${text}`); process.exit(1); }
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }
  if (PROTECTED.includes('dm_customer')) { console.error('Đụng collection được bảo vệ'); process.exit(1); }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });

  const list = await call('GET', '/api/collections?perPage=500', token);
  const customer = list.items.find(c => c.name === 'dm_customer');
  if (!customer) { console.error('Không thấy collection dm_customer — dừng.'); process.exit(1); }

  const fields = customer.fields ?? customer.schema;
  console.log(`PB: ${PB_URL}`);
  console.log('dm_customer đang có các trường:');
  for (const f of fields) console.log(`   ${String(f.name).padEnd(16)} ${f.type}`);

  /* ---------------------- 1. thêm trường ---------------------- */
  if (fields.some(f => f.name === 'low_name')) {
    console.log('\n`low_name` đã có — bỏ qua bước tạo trường.');
  } else if (DRY_RUN) {
    console.log('\n[dry-run] sẽ thêm dm_customer.low_name (text, không bắt buộc)');
  } else {
    await call('PATCH', `/api/collections/${customer.id}`, token, {
      fields: [...fields, { name: 'low_name', type: 'text', required: false, presentable: false }],
    });
    console.log('\n✔ Đã thêm dm_customer.low_name');
  }

  /* ---------------------- 2. backfill ---------------------- */
  const records = [];
  for (let page = 1; ; page++) {
    const r = await call('GET', `/api/collections/dm_customer/records?perPage=500&page=${page}`, token);
    records.push(...r.items);
    if (page >= r.totalPages) break;
  }
  console.log(`\ndm_customer có ${records.length} bản ghi.`);

  let n = 0;
  for (const rec of records) {
    const want = String(rec.name ?? '').toLowerCase();
    if (rec.low_name === want) continue;
    n++;
    if (DRY_RUN) {
      console.log(`   [dry-run] ${rec.mkh}: "${rec.name}" → "${want}"`);
    } else {
      await call('PATCH', `/api/collections/dm_customer/records/${rec.id}`, token, { low_name: want });
    }
  }
  console.log(DRY_RUN ? `[dry-run] sẽ cập nhật ${n} bản ghi.` : `✔ Đã cập nhật ${n} bản ghi.`);
}

main();
