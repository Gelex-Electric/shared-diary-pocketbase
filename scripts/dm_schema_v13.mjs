#!/usr/bin/env node
/**
 * Schema đợt 13 — tách THIẾT BỊ khỏi LẦN LẮP (user chốt 28/08/2026).
 *
 * Vì sao: vòng đời vật tư nay có đoạn NẰM KHO giữa hai lần lắp —
 *
 *   nhập kho → lắp ở A → tháo → nằm kho (rất lâu) → lắp ở B → tháo → thanh lý
 *
 * `dm_asset` mỗi dòng là một LẦN LẮP, nên trạng thái "đang nằm kho" không có
 * chỗ đứng: nó không thuộc lần lắp nào. Thêm nữa, tỷ số TI / model là thuộc
 * tính của THIẾT BỊ mà đang bị chép lại ở mọi dòng lắp, và index
 * `(serial, point)` KHÔNG chặn hai dòng kho trùng số No vì SQLite coi các NULL
 * là khác nhau.
 *
 * Đợt này CHỈ dựng chỗ chứa, chưa đổi hành vi app:
 *   1. Tạo collection `dm_device` — mỗi số No một dòng, `serial` UNIQUE.
 *   2. Thêm `dm_asset.device` (relation, chưa bắt buộc) để nối dần.
 *
 * `dm_asset` giữ nguyên mọi trường cũ. Việc bỏ `serial`/`type`/`ratio_*` khỏi
 * nó là bước 4, làm sau khi app đã chạy thật một thời gian.
 *
 * NGUYÊN TẮC GIỮ NGUYÊN: chỉ tạo mới `dm_device` và sửa `dm_asset`.
 * KHÔNG chạm 9 collection có sẵn.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_schema_v13.mjs --dry-run
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

  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  const before = await collections(token);

  const asset = before['dm_asset'];
  const customer = before['dm_customer'];
  const zone = before['dm_zone'];
  if (!asset || !customer || !zone) {
    console.error('Thiếu dm_asset / dm_customer / dm_zone — dừng.');
    process.exit(1);
  }
  const touched = ['dm_device', 'dm_asset'];
  const clash = touched.filter(n => PROTECTED.includes(n));
  if (clash.length) { console.error(`Đụng collection được bảo vệ: ${clash}`); process.exit(1); }

  console.log(`PB: ${PB_URL}`);
  const nAssets = (await call('GET', '/api/collections/dm_asset/records?perPage=1', token)).totalItems;
  console.log(`dm_asset hiện có ${nAssets} bản ghi.\n`);

  /* ------------------------- 1. dm_device ------------------------- */
  const deviceFields = [
    { name: 'serial', type: 'text', required: true, presentable: true },
    {
      name: 'type', type: 'select', required: true, maxSelect: 1,
      values: ['CONGTO', 'GP03', 'TI', 'TU', 'SIM', 'KHAC'],
    },
    { name: 'ratio_primary', type: 'number', required: false },
    { name: 'ratio_secondary', type: 'number', required: false },
    { name: 'model_desc', type: 'text', required: false },
    /*
      Trạng thái SUY RA, không cho gõ tay ở giao diện: còn lần lắp đang mở ⇒
      `dang_treo`; không còn ⇒ `kho`; `thanh_ly` là quyết định của người dùng.
    */
    {
      name: 'status', type: 'select', required: false, maxSelect: 1,
      values: ['kho', 'dang_treo', 'thanh_ly'],
    },
    // Dành sẵn cho khách ĐÃ có tên trong danh mục…
    {
      name: 'hold_for_customer', type: 'relation', required: false, maxSelect: 1,
      collectionId: customer.id, cascadeDelete: false,
    },
    // …và cho khách CHƯA có tên: gõ tự do, đúng tình huống "đặt về để dành".
    { name: 'hold_for_note', type: 'text', required: false },
    {
      name: 'hold_zone', type: 'relation', required: false, maxSelect: 1,
      collectionId: zone.id, cascadeDelete: false,
    },
    { name: 'date_in', type: 'date', required: false },
    /** Mã lô nhập — nhập một lần 20 TI thì lọc lại theo lô. */
    { name: 'batch', type: 'text', required: false },
    { name: 'note', type: 'text', required: false },
  ];

  const deviceIndexes = [
    // Số No là ĐỊNH DANH THẬT của thiết bị ⇒ UNIQUE thẳng trên nó.
    'CREATE UNIQUE INDEX `idx_uniq_dm_device_serial` ON `dm_device` (`serial`)',
    'CREATE INDEX `idx_dm_device_status` ON `dm_device` (`status`)',
    'CREATE INDEX `idx_dm_device_type` ON `dm_device` (`type`)',
  ];

  const existed = before['dm_device'];
  if (existed) {
    console.log('= Collection dm_device đã có, bỏ qua bước tạo.');
  } else {
    console.log('SẼ TẠO collection dm_device:');
    for (const f of deviceFields) {
      console.log(`   ${f.name.padEnd(18)} ${f.type}${f.required ? ', bắt buộc' : ''}`
        + `${f.values ? ` ${JSON.stringify(f.values)}` : ''}`);
    }
    console.log('   index: serial UNIQUE, status, type');
  }

  /* --------------------- 2. dm_asset.device --------------------- */
  const aFields = asset.fields ?? asset.schema;
  const hasDevice = aFields.some(f => f.name === 'device');
  if (hasDevice) {
    console.log('\n= Trường dm_asset.device đã có, bỏ qua.');
  } else {
    console.log('\nSẼ THÊM dm_asset.device (relation → dm_device, KHÔNG bắt buộc)');
    console.log('   chưa bắt buộc để backfill nối dần mà app cũ vẫn chạy;');
    console.log(`   ${nAssets} bản ghi hiện có không phải sửa gì ở bước này.`);
  }

  if (!existed && !hasDevice) {
    console.log('\nKHÔNG đụng: mọi trường cũ của dm_asset, và 9 collection được bảo vệ.');
  }
  if (DRY_RUN) { console.log('\n[DRY-RUN] Không ghi gì.'); return; }

  if (!existed) {
    await call('POST', '/api/collections', token, {
      name: 'dm_device', type: 'base', fields: deviceFields, indexes: deviceIndexes,
      listRule: '', viewRule: '', createRule: '', updateRule: '', deleteRule: '',
    });
    console.log('OK  tạo dm_device');
  }
  if (!hasDevice) {
    const dev = (await collections(token))['dm_device'];
    await call('PATCH', `/api/collections/${asset.id}`, token, {
      fields: [...aFields, {
        name: 'device', type: 'relation', required: false, maxSelect: 1,
        collectionId: dev.id, cascadeDelete: false,
      }],
    });
    console.log('OK  thêm dm_asset.device');
  }
}

await main();
