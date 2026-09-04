#!/usr/bin/env node
/**
 * Schema đợt 14 — sửa hai chỗ hụt của `dm_device` vừa dựng ở đợt 13
 * (user chốt 28/08/2026).
 *
 * 1. THÊM `hold_point` — "thiết bị này dành sẵn cho điểm đo nào".
 *
 *    Trước đó việc giữ chỗ được biểu diễn bằng một dòng `dm_asset` có `point`
 *    nhưng KHÔNG có `date_on` — tức "một lần lắp chưa xảy ra". Sai ngữ nghĩa,
 *    và bắt MỌI chỗ đọc phải nhớ lọc `date_on`: quên một chỗ là ra 758 "đang
 *    treo" thay vì 605 (đã vấp đúng lỗi này lúc backfill đợt 13).
 *
 *    Giữ chỗ là THUỘC TÍNH của thiết bị, không phải SỰ KIỆN. Cùng họ với
 *    `hold_for_customer` / `hold_for_note` / `hold_zone`, chỉ khác độ cụ thể.
 *
 * 2. BỎ `status`, THAY bằng `liquidated_at`.
 *
 *    `status` là nguồn sự thật thứ hai: `kho` / `dang_treo` luôn suy được từ
 *    các lần lắp, nên cột lưu sẵn chắc chắn sẽ lệch và ai lọc theo nó sẽ nhận
 *    kết quả sai. Thứ DUY NHẤT không suy được là quyết định thanh lý của người
 *    dùng — nên chỉ lưu đúng cái đó, dưới dạng ngày.
 *
 * An toàn: `dm_device` vừa dựng hôm nay, CHƯA màn hình nào đọc, nên bỏ cột
 * `status` lúc này không ảnh hưởng gì. Càng để lâu càng đắt.
 *
 * KHÔNG chạm `dm_asset` ở đợt này: 153 dòng giữ chỗ vẫn nằm nguyên đó cho tới
 * khi form điểm đo được nối lại (bước 3 của plan). Mỗi bước phải tự đứng được.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v14.mjs --dry-run
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

const collections = async (token) =>
  Object.fromEntries((await call('GET', '/api/collections?perPage=500', token)).items.map(c => [c.name, c]));

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }
  if (PROTECTED.includes('dm_device')) { console.error('Đụng collection được bảo vệ'); process.exit(1); }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const cols = await collections(token);
  const dev = cols['dm_device'];
  const point = cols['dm_point'];
  if (!dev) { console.error('Chưa có dm_device — chạy dm_schema_v13.mjs trước.'); process.exit(1); }
  if (!point) { console.error('Không thấy dm_point.'); process.exit(1); }

  const fields = dev.fields ?? dev.schema;
  const has = (n) => fields.some(f => f.name === n);
  const nDev = (await call('GET', '/api/collections/dm_device/records?perPage=1', token)).totalItems;

  console.log(`PB: ${PB_URL}`);
  console.log(`dm_device hiện có ${nDev} bản ghi.\n`);

  const add = [];
  if (!has('hold_point')) {
    add.push({
      name: 'hold_point', type: 'relation', required: false, maxSelect: 1,
      collectionId: point.id, cascadeDelete: false,
    });
    console.log('SẼ THÊM  hold_point     relation → dm_point (dành sẵn cho điểm đo nào)');
  } else console.log('= hold_point đã có.');

  if (!has('liquidated_at')) {
    add.push({ name: 'liquidated_at', type: 'date', required: false });
    console.log('SẼ THÊM  liquidated_at  date (ngày thanh lý — thứ duy nhất không suy được)');
  } else console.log('= liquidated_at đã có.');

  const dropStatus = has('status');
  if (dropStatus) {
    console.log('SẼ BỎ    status         select — suy lại từ các lần lắp, không lưu nữa');
    console.log('         (chưa màn hình nào đọc dm_device nên bỏ lúc này không ảnh hưởng gì)');
  } else console.log('= status đã bỏ.');

  if (!add.length && !dropStatus) { console.log('\nKhông có gì để làm.'); return; }
  console.log('\nKHÔNG đụng: dm_asset, và 9 collection được bảo vệ.');
  if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); return; }

  const next = [...fields.filter(f => f.name !== 'status'), ...add];
  /*
    Phải gỡ index trên `status` CÙNG LÚC bỏ cột. Gửi riêng `fields` thì PB dựng
    lại bảng rồi mới tạo index, và index trỏ vào cột không còn:
      "Failed to create index idx_dm_device_status - no such column: status"
  */
  const indexes = (dev.indexes ?? []).filter(x => !/\(\s*`?status`?\s*\)/i.test(x));
  await call('PATCH', `/api/collections/${dev.id}`, token, { fields: next, indexes });
  console.log('OK  cập nhật dm_device');
}

await main();
