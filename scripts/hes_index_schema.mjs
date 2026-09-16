#!/usr/bin/env node
/**
 * Tạo collection `hes_index` — chỉ số công tơ đầu/cuối ngày, thay dần cho
 * `public/hes_index_daily.csv`.
 *
 * Vì sao chuyển sang PocketBase: `public/` được phục vụ CÔNG KHAI, ai biết URL
 * đều tải được cả file chỉ số không cần đăng nhập. Trên PB thì đọc phải có tài
 * khoản, ghi chỉ superuser.
 *
 * 5 chỉ số lưu RAW, CHƯA nhân HSN — đúng quy ước của `fetch_hes_index`; cột
 * `hsn` đi kèm để nơi đọc tự nhân. Xem `document/API_HES.md`:
 *   pg = ACTIVE_KW_INDICATE_TOTAL   (hữu công tổng — phần tính tiền điện)
 *   bt = ACTIVE_KW_INDICATE_RATE1   (biểu 1 — bình thường)
 *   cd = ACTIVE_KW_INDICATE_RATE2   (biểu 2 — cao điểm)
 *   td = ACTIVE_KW_INDICATE_RATE3   (biểu 3 — thấp điểm)
 *   vc = REACTIVE_KVAR_INDICATE_TOTAL (vô công tổng)
 *
 * KHÔNG chạm bất kỳ collection nào đang có — chỉ TẠO MỚI `hes_index`. Nếu
 * collection đã tồn tại thì in ra rồi dừng, không sửa gì.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/hes_index_schema.mjs --dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/hes_index_schema.mjs
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS || '';
const DRY_RUN = process.argv.includes('--dry-run');

const NAME = 'hes_index';

/** Collection KHÔNG được đụng tới — script này vốn chỉ tạo mới, đây là chốt chặn. */
const PROTECTED = [
  'handovers', 'invoice', 'notifications', 'Electric_shift', 'FigureBook',
  'PowerOutage', 'AccountHes', 'New_update', 'users',
  'dm_zone', 'dm_station', 'dm_point', 'dm_customer', 'dm_asset', 'dm_device',
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

const num = (name) => ({ name, type: 'number', required: false, presentable: false });
const txt = (name, required = false) => ({ name, type: 'text', required, presentable: false });

const FIELDS = [
  txt('meter_no', true),
  txt('date', true),          // YYYY-MM-DD
  num('hsn'),
  txt('start_time'), txt('end_time'),
  num('pg_start'), num('bt_start'), num('cd_start'), num('td_start'), num('vc_start'),
  num('pg_end'), num('bt_end'), num('cd_end'), num('td_end'), num('vc_end'),
  /* Liệt kê chỉ số chạy thụt lùi, vd "pg,vc". Rỗng = bình thường. */
  txt('regress'),
  { name: 'no_data', type: 'bool', required: false, presentable: false },
];

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (hoặc PB_EMAIL/PB_PASS)');
    process.exit(1);
  }
  if (PROTECTED.includes(NAME)) { console.error('Đụng collection được bảo vệ'); process.exit(1); }

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });

  const list = await call('GET', '/api/collections?perPage=500', token);
  console.log(`PB: ${PB_URL}`);
  console.log(`Đang có ${list.items.length} collection.`);

  if (list.items.some(c => c.name === NAME)) {
    console.log(`\n\`${NAME}\` ĐÃ TỒN TẠI — không sửa gì, dừng tại đây.`);
    console.log('Muốn đổi schema thì sửa tay trên giao diện PB, hoặc viết script đợt sau.');
    return;
  }

  const body = {
    name: NAME,
    type: 'base',
    fields: FIELDS,
    /*
      Đọc phải đăng nhập; ghi chỉ superuser (rule = null). Đây chính là phần
      "tăng bảo mật" so với file CSV trong public/.
    */
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null, updateRule: null, deleteRule: null,
    /* Một công tơ một ngày một bản ghi — chạy lại pipeline không sinh trùng. */
    indexes: [`CREATE UNIQUE INDEX \`idx_${NAME}_meter_date\` ON \`${NAME}\` (\`meter_no\`, \`date\`)`],
  };

  if (DRY_RUN) {
    console.log(`\n[dry-run] sẽ tạo \`${NAME}\` với ${FIELDS.length} trường:`);
    for (const f of FIELDS) console.log(`   ${f.name.padEnd(12)} ${f.type}`);
    console.log('   + index UNIQUE (meter_no, date)');
    console.log('   + listRule/viewRule: phải đăng nhập; create/update/delete: chỉ superuser');
    return;
  }

  await call('POST', '/api/collections', token, body);
  console.log(`\n✔ Đã tạo \`${NAME}\` (${FIELDS.length} trường, UNIQUE meter_no+date).`);
}

main();
