#!/usr/bin/env node
/**
 * Schema đợt 12 — thêm `dm_point.owner_history` (user chốt 27/08/2026).
 *
 * Chuyển chủ thể: khách hàng đứng tên điểm đo đổi (hợp nhất pháp nhân, chuyển
 * nhượng nhà xưởng) trong khi ĐIỂM ĐO VẬT LÝ không đổi — vẫn máy biến áp ấy,
 * công tơ ấy, HSN ấy.
 *
 * Trường này giữ danh sách các lần chuyển, mỗi lần một object:
 *
 *   [{ "from": "KCNTTI-005", "to": "KCNTTI-004",
 *      "date": "2026-07-21", "reason": "hợp nhất pháp nhân" }]
 *
 * Có mặt nó còn mang nghĩa thứ hai: MÃ ĐIỂM ĐO ĐÃ ĐƯỢC GIỮ LẠI. Mã nhúng tên
 * tắt khách hàng nên đổi chủ sẽ làm mã tự đổi theo, mà mã điểm đo chính là
 * `LINE_NAME` bên HES — đổi là lệch với dữ liệu đo đếm. Vì vậy điểm đo có lịch
 * sử chuyển chủ thì form KHÔNG sinh lại mã nữa, trừ khi người dùng bấm nút.
 *
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_point`. KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v12.mjs --dry-run
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');

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

const collections = async token =>
  Object.fromEntries((await call('GET', '/api/collections?perPage=500', token)).items.map(c => [c.name, c]));

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const before = await collections(token);
  const point = before['dm_point'];
  if (!point) { console.error('Không thấy dm_point.'); process.exit(1); }

  const fields = point.fields ?? point.schema;
  console.log(`PB: ${PB_URL}`);
  if (fields.some(f => f.name === 'owner_history')) {
    console.log('= Trường owner_history đã có, không làm gì.');
    return;
  }

  const nRecs = (await call('GET', '/api/collections/dm_point/records?perPage=1', token)).totalItems;
  console.log(`dm_point hiện có ${nRecs} bản ghi — thêm trường không bắt buộc, không bản ghi nào phải sửa.`);
  console.log('SẼ THÊM: owner_history (json, không bắt buộc)');

  if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); return; }

  await call('PATCH', `/api/collections/${point.id}`, token, {
    fields: [...fields, { name: 'owner_history', type: 'json', required: false, presentable: false, maxSize: 200000 }],
  });
  console.log('\n  ✓ dm_point: đã thêm owner_history');

  const after = await collections(token);
  console.log('\nĐối chiếu collection có sẵn:');
  let bad = false;
  for (const name of [...PROTECTED].sort()) {
    const b = stable(before[name]);
    const a = after[name] ? stable(after[name]) : null;
    if (a === null || a !== b) { console.log(`  ✗ ${name}: BỊ THAY ĐỔI`); bad = true; }
    else console.log(`  ✓ ${name}: nguyên vẹn`);
  }
  const n2 = (await call('GET', '/api/collections/dm_point/records?perPage=1', token)).totalItems;
  console.log(`\ndm_point: ${nRecs} → ${n2} bản ghi (phải bằng nhau).`);
  if (bad) { console.error('LỖI: có collection cũ bị đụng vào.'); process.exit(1); }
}

main();
