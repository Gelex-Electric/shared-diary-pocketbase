#!/usr/bin/env node
/**
 * Schema đợt 9 — đổi ràng buộc duy nhất của `dm_asset` từ `(serial)` sang
 * `(serial, point)` (user chốt 20/08/2026).
 *
 * Vì sao: một công tơ tháo ở điểm đo A rồi lắp sang điểm đo B là chuyện bình
 * thường. Với unique trên riêng `serial`, PocketBase chặn hẳn — muốn lắp sang
 * chỗ mới thì buộc phải SỬA bản ghi cũ, và điểm đo A mất sạch dấu vết từng lắp
 * công tơ đó (tab "Theo điểm đo" ở màn Vòng đời sẽ thiếu một đời công tơ).
 *
 * Unique theo cặp `(serial, point)` giữ được lịch sử ở cả hai điểm đo, mà vẫn
 * chặn gõ trùng số chế tạo trong CÙNG một điểm đo.
 *
 * Việc "không được đang đo ở hai nơi cùng lúc" do tầng giao diện chặn (không
 * cho lưu khi số công tơ đó còn hoạt động ở điểm đo khác) — SQL index không
 * diễn đạt được điều kiện đó.
 *
 * KHÔNG mất dữ liệu: chỉ đổi index, không đụng field, không đụng bản ghi.
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ đụng `dm_asset`. KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v9.mjs --dry-run
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const DRY_RUN = process.argv.includes('--dry-run');

const OLD_INDEX = 'idx_uniq_dm_asset_serial';
const NEW_INDEX = 'CREATE UNIQUE INDEX `idx_uniq_dm_asset_serial_point` ON `dm_asset` (`serial`, `point`)';

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

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
    process.exit(1);
  }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const before = await collections(token);
  const asset = before['dm_asset'];
  if (!asset) { console.error('Không thấy dm_asset.'); process.exit(1); }

  console.log(`PB: ${PB_URL}`);
  console.log('Index hiện có:');
  for (const i of asset.indexes) console.log(`   ${i}`);

  if (asset.indexes.some(i => i.includes('idx_uniq_dm_asset_serial_point'))) {
    console.log('\n= Index (serial, point) đã có, không làm gì.');
    return;
  }

  // Chốt chặn: cặp (serial, point) phải đang duy nhất, kẻo tạo index sẽ lỗi.
  const recs = await call('GET', '/api/collections/dm_asset/records?perPage=500', token);
  const seen = new Map();
  for (const r of recs.items) {
    const key = `${r.serial}|${r.point}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1);
  console.log(`\n${recs.totalItems} bản ghi, ${dup.length} cặp (serial, điểm đo) bị trùng`);
  if (dup.length) {
    for (const [k, n] of dup) console.log(`   ${k} × ${n}`);
    console.error('DỪNG: phải dọn trùng trước, không thì tạo unique index sẽ lỗi.');
    process.exit(1);
  }

  const next = asset.indexes.filter(i => !i.includes(OLD_INDEX)).concat(NEW_INDEX);
  console.log('\nIndex sau khi đổi:');
  for (const i of next) console.log(`   ${i}`);

  if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); return; }

  await call('PATCH', `/api/collections/${asset.id}`, token, { indexes: next });
  console.log('\n  ✓ dm_asset: đã đổi sang unique (serial, point)');

  const after = await collections(token);
  console.log('\nĐối chiếu collection có sẵn:');
  let bad = false;
  for (const name of [...PROTECTED].sort()) {
    const b = stable(before[name]);
    const a = after[name] ? stable(after[name]) : null;
    if (a === null || a !== b) { console.log(`  ✗ ${name}: BỊ THAY ĐỔI`); bad = true; }
    else console.log(`  ✓ ${name}: nguyên vẹn`);
  }
  console.log('\ndm_asset indexes:');
  for (const i of after['dm_asset'].indexes) console.log(`   ${i}`);
  const n = (await call('GET', '/api/collections/dm_asset/records?perPage=1', token)).totalItems;
  console.log(`dm_asset: ${recs.totalItems} → ${n} bản ghi (phải bằng nhau).`);
  if (bad) { console.error('LỖI: có collection cũ bị đụng vào.'); process.exit(1); }
}

main();
