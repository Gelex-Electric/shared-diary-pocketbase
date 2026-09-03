#!/usr/bin/env node
/**
 * Schema đợt 8 — xoá cột `name` khỏi `dm_station` (user yêu cầu 19/08/2026).
 *
 * Lý do: trạm đã có `code` do hệ thống sinh (TH.BQL-TH.T1.180kVA) mang đủ
 * thông tin KCN + khách hàng + định danh + công suất. `name` gõ tay không dùng
 * vào việc gì — đã gỡ khỏi form Thêm/Sửa trạm, khỏi ô tìm kiếm và khỏi cây dữ
 * liệu, nên dọn nốt dưới DB cho khỏi thành cột chết.
 *
 * XOÁ FIELD LÀ THAO TÁC MẤT DỮ LIỆU: script tự đếm bản ghi còn giá trị ở
 * `name` và DỪNG nếu có, trừ khi chạy kèm `--force` (theo mẫu v6).
 *
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_station`. KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v8.mjs --dry-run
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

/**
 * Chuỗi hoá ổn định: sắp khoá ở MỌI cấp rồi mới JSON.stringify, để so 2 bản
 * chụp collection theo nội dung chứ không theo thứ tự khoá PB trả về.
 */
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
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
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

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
    process.exit(1);
  }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const before = await collections(token);
  const station = before['dm_station'];
  if (!station) {
    console.error('Không thấy dm_station.');
    process.exit(1);
  }

  console.log(`PB: ${PB_URL}`);
  if (!station.fields.some(f => f.name === 'name')) {
    console.log('= dm_station.name: không còn, không làm gì.');
    return;
  }

  // Đếm bản ghi còn dữ liệu ở cột sắp xoá.
  const recs = await call('GET', '/api/collections/dm_station/records?perPage=500', token);
  const dirty = recs.items.filter(r => r.name);
  console.log(`dm_station: ${recs.totalItems} bản ghi, ${dirty.length} bản ghi còn giá trị ở cột \`name\``);
  for (const r of dirty.slice(0, 10)) console.log(`   ${r.code} → name="${r.name}"`);

  if (dirty.length && !FORCE) {
    console.error('DỪNG: xoá cột sẽ mất dữ liệu trên. Chạy lại kèm --force nếu vẫn muốn.');
    process.exit(1);
  }

  console.log('Sẽ XOÁ dm_station.name');
  if (DRY_RUN) {
    console.log('[DRY-RUN] Không ghi gì.');
    return;
  }

  await call('PATCH', `/api/collections/${station.id}`, token,
    { fields: station.fields.filter(f => f.name !== 'name') });
  console.log('  ✓ dm_station: đã xoá cột name');

  const after = await collections(token);
  console.log('\nĐối chiếu collection có sẵn:');
  let bad = false;
  for (const name of [...PROTECTED].sort()) {
    const b = stable(before[name]);
    const a = after[name] ? stable(after[name]) : null;
    if (a === null || a !== b) { console.log(`  ✗ ${name}: BỊ THAY ĐỔI`); bad = true; }
    else console.log(`  ✓ ${name}: nguyên vẹn`);
  }
  console.log('\ndm_station: ' +
    after['dm_station'].fields.filter(f => f.name !== 'id').map(f => f.name).join(', '));
  if (bad) {
    console.error('LỖI: có collection cũ bị đụng vào.');
    process.exit(1);
  }
}

main();
