#!/usr/bin/env node
/**
 * Schema đợt 10 — thêm 2 trường "dự kiến" vào `dm_asset` (user chốt 25/08/2026):
 *
 *   plan_customer  relation → dm_customer   (không bắt buộc)
 *   plan_point     relation → dm_point      (không bắt buộc)
 *
 * Vì sao: vật tư mua về nằm kho chờ lắp thì chưa gắn điểm đo nào (`point` rỗng),
 * nhưng thường đã biết sẽ lắp cho ai — ví dụ bộ TI 1500/5 mua để thay cho
 * `YM.FUMAO.T1.800kVA` khi trạm sắp quá tải. Không có chỗ ghi thì kế hoạch đó
 * chỉ nằm trong đầu người phụ trách.
 *
 * KHÔNG đụng gì tới vật tư đang lắp: hai trường mới đều để trống, `point` và
 * `active` giữ nguyên vai trò cũ. Vật tư dự kiến nhận biết bằng `point` RỖNG.
 *
 * Số chế tạo vẫn BẮT BUỘC (user chốt): chỉ khai vật tư đã có thật trong tay,
 * không khai kế hoạch mua sắm. Nhờ vậy ràng buộc `(serial, point)` giữ nguyên.
 *
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_asset`. KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v10.mjs --dry-run
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');

const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

/** Chuỗi hoá ổn định: sắp khoá ở MỌI cấp rồi mới stringify, để so theo nội dung. */
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
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${path}\n${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

async function collections(token) {
  const { items } = await call('GET', '/api/collections?perPage=500', token);
  return Object.fromEntries(items.map(c => [c.name, c]));
}

/** Trường relation một-chiều, không bắt buộc, không xoá lan. */
const relationField = (name, collectionId) => ({
  name,
  type: 'relation',
  required: false,
  presentable: false,
  collectionId,
  cascadeDelete: false,
  maxSelect: 1,
  minSelect: 0,
});

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
    process.exit(1);
  }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const before = await collections(token);

  const asset = before['dm_asset'];
  const customer = before['dm_customer'];
  const point = before['dm_point'];
  if (!asset || !customer || !point) {
    console.error('Thiếu một trong: dm_asset, dm_customer, dm_point.');
    process.exit(1);
  }

  const fields = asset.fields ?? asset.schema;
  const has = name => fields.some(f => f.name === name);

  console.log(`PB: ${PB_URL}`);
  console.log('dm_asset đang có các trường:');
  for (const f of fields) console.log(`   ${f.name.padEnd(16)} ${f.type}`);

  const toAdd = [];
  if (!has('plan_customer')) toAdd.push(relationField('plan_customer', customer.id));
  if (!has('plan_point')) toAdd.push(relationField('plan_point', point.id));

  if (!toAdd.length) {
    console.log('\n= Hai trường plan_* đã có, không làm gì.');
    return;
  }
  console.log(`\nSẼ THÊM ${toAdd.length} trường: ${toAdd.map(f => f.name).join(', ')}`);

  const nRecs = (await call('GET', '/api/collections/dm_asset/records?perPage=1', token)).totalItems;
  console.log(`dm_asset hiện có ${nRecs} bản ghi — thêm trường không bắt buộc nên không bản ghi nào phải sửa.`);

  if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); return; }

  await call('PATCH', `/api/collections/${asset.id}`, token, { fields: [...fields, ...toAdd] });
  console.log('\n  ✓ dm_asset: đã thêm plan_customer, plan_point');

  const after = await collections(token);
  console.log('\nĐối chiếu collection có sẵn:');
  let bad = false;
  for (const name of [...PROTECTED].sort()) {
    const b = stable(before[name]);
    const a = after[name] ? stable(after[name]) : null;
    if (a === null || a !== b) { console.log(`  ✗ ${name}: BỊ THAY ĐỔI`); bad = true; }
    else console.log(`  ✓ ${name}: nguyên vẹn`);
  }

  console.log('\ndm_asset sau khi đổi:');
  for (const f of (after['dm_asset'].fields ?? after['dm_asset'].schema)) {
    console.log(`   ${f.name.padEnd(16)} ${f.type}`);
  }
  const n2 = (await call('GET', '/api/collections/dm_asset/records?perPage=1', token)).totalItems;
  console.log(`dm_asset: ${nRecs} → ${n2} bản ghi (phải bằng nhau).`);
  if (bad) { console.error('LỖI: có collection cũ bị đụng vào.'); process.exit(1); }
}

main();
