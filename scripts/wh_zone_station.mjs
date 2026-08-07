/**
 * Bổ sung cấu trúc đơn vị cho bộ `wh_*`: collection `wh_zone`, `wh_station`,
 * và hai trường mới `role` / `station` trên `wh_point`.
 *
 * Vì sao cần (user chốt 07/08, màn hình 3 dải Card KCN → Trạm → Điểm đo):
 *   - KCN trước đây chỉ là 6 giá trị cố định trong ô `select` → không thêm được
 *     từ giao diện, vì thêm giá trị là sửa cấu trúc collection.
 *   - Trạm trước đây chỉ là chữ trên từng điểm đo → trạm chưa có điểm đo nào thì
 *     không có chỗ nào lưu, mở lại trang là mất.
 *   - Chính/phụ chưa có trường nào để lưu.
 *
 * Chạy:
 *   PB_URL=... PB_EMAIL=... PB_PASS=... node scripts/wh_zone_station.mjs [--commit]
 * MẶC ĐỊNH LÀ DRY-RUN. Không có --commit thì chỉ in ra sẽ làm gì.
 *
 * AN TOÀN — script này CHỈ THÊM, không bao giờ xoá hay sửa thứ đang có:
 *   - Chỉ đụng tới collection tên bắt đầu bằng `wh_` (hàm guard).
 *   - Collection đã tồn tại thì bỏ qua, KHÔNG ghi đè.
 *   - Với `wh_point`: đọc danh sách trường hiện có rồi NỐI THÊM trường mới vào
 *     cuối. Không sửa, không bỏ trường nào — mất một trường ở đây là mất dữ liệu
 *     của 160 điểm đo.
 * Chạy lại nhiều lần vô hại.
 */

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_EMAIL || '';
const PB_PASS = process.env.PB_PASS || '';
const COMMIT = process.argv.includes('--commit');

if (!PB_EMAIL || !PB_PASS) {
  console.error('Thieu PB_EMAIL / PB_PASS.');
  process.exit(1);
}

const PREFIX = 'wh_';
function guard(name) {
  if (!name.startsWith(PREFIX)) {
    throw new Error(`TU CHOI: "${name}" khong mang tien to "${PREFIX}".`);
  }
}

let token = '';
async function api(method, path, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

const txt = (name, required = false) => ({ name, type: 'text', required });
const num = (name) => ({ name, type: 'number', required: false });
const sel = (name, values) => ({ name, type: 'select', required: false, maxSelect: 1, values });
const rel = (name, collectionId) =>
  ({ name, type: 'relation', required: false, collectionId, maxSelect: 1, cascadeDelete: false });

const READ = '@request.auth.id != ""';
const WRITE = '@request.auth.id != "" && @request.auth.area = ""';
const RULES = { listRule: READ, viewRule: READ, createRule: WRITE, updateRule: WRITE, deleteRule: WRITE };

/** 5 KCN thật + kho văn phòng, đúng chuỗi đang nằm trong `wh_point.zone`. */
const SEED_ZONES = [
  { code: 'KCN Tiền Hải', name: 'KCN Tiền Hải', order_index: 1 },
  { code: 'KCN Phong Điền', name: 'KCN Phong Điền', order_index: 2 },
  { code: 'KCN Thuận Thành I', name: 'KCN Thuận Thành I', order_index: 3 },
  { code: 'KCN Yên Mỹ', name: 'KCN Yên Mỹ', order_index: 4 },
  { code: 'KCN Số 3', name: 'KCN Số 3', order_index: 5 },
  { code: 'GETC', name: 'Văn phòng GETC', order_index: 6 },
];

async function main() {
  const auth = await api('POST', '/api/collections/_superusers/auth-with-password', {
    identity: PB_EMAIL, password: PB_PASS,
  });
  token = auth.token;
  console.log(`Da dang nhap superuser tai ${PB_URL}${COMMIT ? '' : '  [DRY-RUN]'}`);

  const list = await api('GET', '/api/collections?perPage=200');
  const byName = Object.fromEntries(list.items.map(c => [c.name, c]));
  console.log(`Hien co ${list.items.length} collection.`);

  /* ---------- 1. wh_zone ---------- */
  guard('wh_zone');
  if (byName.wh_zone) {
    console.log('  bo qua wh_zone (da ton tai)');
  } else if (!COMMIT) {
    console.log('  [dry-run] se tao wh_zone');
  } else {
    byName.wh_zone = await api('POST', '/api/collections', {
      name: 'wh_zone', type: 'base', ...RULES,
      fields: [txt('code', true), txt('name', true), num('order_index'), txt('note')],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_zone_code` ON `wh_zone` (`code`)'],
    });
    console.log('  da tao wh_zone');
  }

  /* ---------- 2. wh_station ---------- */
  guard('wh_station');
  if (byName.wh_station) {
    console.log('  bo qua wh_station (da ton tai)');
  } else if (!COMMIT) {
    console.log('  [dry-run] se tao wh_station');
  } else {
    byName.wh_station = await api('POST', '/api/collections', {
      name: 'wh_station', type: 'base', ...RULES,
      fields: [
        txt('code', true), txt('name'),
        rel('zone', byName.wh_zone.id),
        txt('mba'), num('cong_suat_kva'), txt('note'),
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_station_code` ON `wh_station` (`code`)'],
    });
    console.log('  da tao wh_station');
  }

  /* ---------- 3. them truong vao wh_point ---------- */
  guard('wh_point');
  const point = byName.wh_point;
  if (!point) throw new Error('Khong tim thay wh_point.');

  const has = new Set(point.fields.map(f => f.name));
  const them = [];
  if (!has.has('role')) them.push(sel('role', ['chinh', 'phu']));
  if (!has.has('station') && byName.wh_station) them.push(rel('station', byName.wh_station.id));

  if (!them.length) {
    console.log('  wh_point da du truong role/station');
  } else if (!COMMIT) {
    console.log(`  [dry-run] se them vao wh_point: ${them.map(f => f.name).join(', ')}`);
  } else {
    // NOI THEM vao cuoi, giu nguyen toan bo truong cu.
    await api('PATCH', `/api/collections/${point.id}`, { fields: [...point.fields, ...them] });
    console.log(`  da them vao wh_point: ${them.map(f => f.name).join(', ')}`);
  }

  /* ---------- 4. seed wh_zone ---------- */
  if (byName.wh_zone && COMMIT) {
    const cur = await api('GET', '/api/collections/wh_zone/records?perPage=200');
    const co = new Set(cur.items.map(z => z.code));
    for (const z of SEED_ZONES) {
      if (co.has(z.code)) continue;
      await api('POST', '/api/collections/wh_zone/records', z);
      console.log(`  seed KCN: ${z.code}`);
    }
  } else if (byName.wh_zone) {
    console.log(`  [dry-run] se seed ${SEED_ZONES.length} KCN`);
  }

  console.log(COMMIT ? 'Xong.' : 'Dry-run xong — them --commit de ghi that.');
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
