#!/usr/bin/env node
/**
 * Schema đợt 11 — GỠ hai trường `plan_customer` / `plan_point` khỏi `dm_asset`.
 *
 * Thêm ở đợt 10 (sáng 25/08/2026) cho tab "Vật tư dự kiến" riêng. Chiều cùng
 * ngày user chốt cách đơn giản hơn: vật tư dự kiến khai thẳng ở bảng vật tư của
 * điểm đo, dòng nào CHƯA CÓ NGÀY TREO thì coi là dự kiến. Không còn màn riêng
 * nên hai trường này thành cột chết.
 *
 * AN TOÀN: script DỪNG nếu có bản ghi nào đang dùng hai trường đó.
 *
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_asset`. KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v11.mjs --dry-run
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');
const DROP = ['plan_customer', 'plan_point'];

const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

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

async function collections(token) {
  const { items } = await call('GET', '/api/collections?perPage=500', token);
  return Object.fromEntries(items.map(c => [c.name, c]));
}

/** Lấy HẾT bản ghi, CÓ PHÂN TRANG — `dm_asset` đã vượt 500 nên lấy 1 trang là thiếu. */
async function allRecords(token, col) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await call('GET', `/api/collections/${col}/records?perPage=500&page=${page}`, token);
    out.push(...r.items);
    if (page >= r.totalPages) return out;
  }
}

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const before = await collections(token);
  const asset = before['dm_asset'];
  if (!asset) { console.error('Không thấy dm_asset.'); process.exit(1); }

  const fields = asset.fields ?? asset.schema;
  const present = DROP.filter(name => fields.some(f => f.name === name));
  console.log(`PB: ${PB_URL}`);
  if (!present.length) { console.log('= Hai trường plan_* không còn, không làm gì.'); return; }
  console.log(`Sẽ gỡ: ${present.join(', ')}`);

  const recs = await allRecords(token, 'dm_asset');
  const used = recs.filter(r => present.some(name => r[name]));
  console.log(`dm_asset: ${recs.length} bản ghi, ${used.length} bản ghi đang dùng hai trường này`);
  if (used.length) {
    for (const r of used.slice(0, 10)) console.log(`   ${r.serial} → ${present.map(k => `${k}=${r[k]}`).join(' ')}`);
    console.error('DỪNG: gỡ trường sẽ mất dữ liệu. Xử lý các bản ghi trên trước.');
    process.exit(1);
  }

  if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); return; }

  const next = fields.filter(f => !present.includes(f.name));
  await call('PATCH', `/api/collections/${asset.id}`, token, { fields: next });
  console.log(`\n  ✓ dm_asset: đã gỡ ${present.join(', ')}`);

  const after = await collections(token);
  console.log('\nĐối chiếu collection có sẵn:');
  let bad = false;
  for (const name of [...PROTECTED].sort()) {
    const b = stable(before[name]);
    const a = after[name] ? stable(after[name]) : null;
    if (a === null || a !== b) { console.log(`  ✗ ${name}: BỊ THAY ĐỔI`); bad = true; }
    else console.log(`  ✓ ${name}: nguyên vẹn`);
  }
  console.log('\ndm_asset sau khi gỡ:');
  for (const f of (after['dm_asset'].fields ?? after['dm_asset'].schema)) console.log(`   ${f.name}`);
  const n2 = (await call('GET', '/api/collections/dm_asset/records?perPage=1', token)).totalItems;
  console.log(`dm_asset: ${recs.length} → ${n2} bản ghi (phải bằng nhau).`);
  if (bad) { console.error('LỖI: có collection cũ bị đụng vào.'); process.exit(1); }
}

main();
