#!/usr/bin/env node
/**
 * Schema đợt 7 — thêm 3 cột vào `dm_asset` (user yêu cầu 19/08/2026):
 *
 *   date_on   date  Ngày treo thiết bị lên điểm đo
 *   date_off  date  Ngày tháo thiết bị khỏi điểm đo
 *   active    bool  Thiết bị có đang hoạt động tại điểm đo hay không
 *
 * Vì sao `active` tách khỏi `status` có sẵn: `status` (dang_treo/kho/thao_go/
 * thanh_ly) là vòng đời vật tư trong KHO; `active` là "có đang đo ở điểm đo
 * này không". Gạt tắt thanh trượt mà đè lên `status` sẽ xoá mất thông tin kho.
 *
 * VÌ SAO VIẾT BẰNG NODE (v1–v6 viết bằng Python): máy PC hiện tại KHÔNG có
 * Python. Node portable là runtime duy nhất chắc chắn có trên cả 2 máy
 * (`~/.railway/bin/node-v20.19.0-win-x64`) — xem CLAUDE.md.
 *
 * CHỈ THÊM CỘT — thao tác không mất dữ liệu, khác hẳn đợt 6 (xoá cột).
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_asset`. KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v7.mjs --dry-run
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');

const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
];

/** Cột mới. `date` của PocketBase lưu chuỗi ISO; UI chỉ dùng phần YYYY-MM-DD. */
const NEW_FIELDS = [
  { name: 'date_on', type: 'date', required: false },
  { name: 'date_off', type: 'date', required: false },
  { name: 'active', type: 'bool', required: false },
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
  const asset = before['dm_asset'];
  if (!asset) {
    console.error('Chưa có dm_asset — chạy scripts/dm_schema_v5.py trước.');
    process.exit(1);
  }

  const have = new Set(asset.fields.map(f => f.name));
  const missing = NEW_FIELDS.filter(f => !have.has(f.name));

  console.log(`PB: ${PB_URL}`);
  console.log('dm_asset hiện có: ' +
    asset.fields.filter(f => f.name !== 'id').map(f => f.name).join(', '));

  if (missing.length === 0) {
    console.log('= Đã có đủ 3 cột date_on / date_off / active, không làm gì.');
    return;
  }

  console.log('Sẽ THÊM: ' + missing.map(f => `${f.name} (${f.type})`).join(', '));
  if (DRY_RUN) {
    console.log('[DRY-RUN] Không ghi gì.');
    return;
  }

  await call('PATCH', `/api/collections/${asset.id}`, token,
    { fields: [...asset.fields, ...missing] });
  console.log('  ✓ dm_asset: đã thêm ' + missing.map(f => f.name).join(', '));

  const after = await collections(token);
  console.log('\nĐối chiếu collection có sẵn:');
  let bad = false;
  for (const name of [...PROTECTED].sort()) {
    const b = stable(before[name]);
    const a = after[name] ? stable(after[name]) : null;
    if (a === null || a !== b) { console.log(`  ✗ ${name}: BỊ THAY ĐỔI`); bad = true; }
    else console.log(`  ✓ ${name}: nguyên vẹn`);
  }
  console.log('\ndm_asset: ' +
    after['dm_asset'].fields.filter(f => f.name !== 'id').map(f => f.name).join(', '));
  if (bad) {
    console.error('LỖI: có collection cũ bị đụng vào.');
    process.exit(1);
  }
}

main();
