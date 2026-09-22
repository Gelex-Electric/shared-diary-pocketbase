#!/usr/bin/env node
/**
 * Tạo collection `dm_line` (LỘ ĐƯỜNG DÂY) và thêm cột `line` vào `dm_station`.
 *
 * Cấp mới trong cây danh mục (user chốt 22/09/2026):
 *   KCN (dm_zone) → LỘ (dm_line) → Trạm (dm_station) → Điểm đo (dm_point)
 *
 * MỘT LỘ THUỘC ĐÚNG MỘT KCN (user xác nhận 22/09): một KCN có nhiều lộ, nhưng
 * lộ không vắt sang KCN khác. Nên `zone` để maxSelect 1, không phải đa trị.
 *
 * `dm_station.line` KHÔNG BẮT BUỘC — và đó là quyết định có chủ đích:
 * 133 trạm hiện chưa có lộ nào. Nếu bắt buộc, hoặc nếu suy KCN qua lộ thay vì
 * giữ `dm_station.zone`, thì ngay sau khi đổi toàn bộ 133 trạm rơi khỏi cây và
 * màn hình trống trơn cho tới khi khai xong hết lộ. Trạm chưa gắn lộ hiện ở
 * nhánh "Chưa gắn lộ" ngay trong KCN của nó.
 *
 * `cascadeDelete = false`: xoá một lộ thì trạm quay về "Chưa gắn lộ", KHÔNG bị
 * xoá theo. Trạm là tài sản có thật ngoài hiện trường, không thể biến mất vì
 * một bản ghi hành chính bị xoá.
 *
 * CHỈ THÊM, không sửa và không xoá gì đang có. Chạy lại bao nhiêu lần cũng cho
 * cùng kết quả.
 *
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_line_schema.mjs --dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_line_schema.mjs
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS || '';
const DRY_RUN = process.argv.includes('--dry-run');

const NAME = 'dm_line';
/** Cùng một quyền với `dm_zone`/`dm_station` — không nới, không siết. */
const RULE = "@request.auth.id != ''";

async function call(method, path, token, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`HTTP ${res.status} ${method} ${path}\n${text.slice(0, 400)}`); process.exit(1); }
  return text ? JSON.parse(text) : {};
}

const txt = (name, required = false) => ({ name, type: 'text', required, presentable: false });

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (hoặc PB_EMAIL/PB_PASS)');
    process.exit(1);
  }
  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });
  console.log(`PB: ${PB_URL}${DRY_RUN ? '   [DRY-RUN]' : ''}`);

  const list = await call('GET', '/api/collections?perPage=500', token);
  const zoneCol = list.items.find(c => c.name === 'dm_zone');
  const stationCol = list.items.find(c => c.name === 'dm_station');
  if (!zoneCol || !stationCol) { console.error('Không thấy dm_zone / dm_station.'); process.exit(1); }

  /* ---------------------- 1. collection dm_line ---------------------- */
  const FIELDS = [
    /* Mã NHẬP TAY, không sinh tự động: mã lộ ("471-E27.1") là tên ngoài đời do
       ngành điện đặt, không suy ra được từ dữ liệu nào trong app — khác mã trạm
       và mã điểm đo vốn nhúng tên tắt khách hàng và công suất. */
    txt('code', true),
    txt('name'),
    {
      name: 'zone', type: 'relation', required: true, presentable: false,
      collectionId: zoneCol.id, cascadeDelete: false, maxSelect: 1,
    },
    /* Dùng lại đúng bộ giá trị của `VoltageLevel` bên app (src/lib/dm/types.ts). */
    {
      name: 'voltage_level', type: 'select', required: false, presentable: false,
      maxSelect: 1, values: ['LV', 'MV'],
    },
    txt('note'),
    /* Lộ cắt/bỏ thì TẮT, không xoá — trạm từng gắn vào nó vẫn cần tra lại được. */
    { name: 'active', type: 'bool', required: false, presentable: false },
  ];

  let lineCol = list.items.find(c => c.name === NAME);
  if (lineCol) {
    console.log(`\n\`${NAME}\` đã tồn tại — bỏ qua bước tạo.`);
  } else if (DRY_RUN) {
    console.log(`\n[dry-run] sẽ tạo \`${NAME}\`: ${FIELDS.map(f => f.name).join(', ')}`);
  } else {
    lineCol = await call('POST', '/api/collections', token, {
      name: NAME, type: 'base', fields: FIELDS,
      listRule: RULE, viewRule: RULE, createRule: RULE, updateRule: RULE, deleteRule: RULE,
      indexes: [`CREATE UNIQUE INDEX \`idx_${NAME}_code\` ON \`${NAME}\` (\`code\`)`],
    });
    console.log(`\n✔ Đã tạo \`${NAME}\` (${FIELDS.length} trường, mã lộ là duy nhất).`);
  }

  /* ------------------- 2. cột `line` ở dm_station ------------------- */
  const has = stationCol.fields.some(f => f.name === 'line');
  if (has) {
    console.log('`dm_station.line` đã có — bỏ qua.');
  } else if (DRY_RUN || !lineCol) {
    console.log('[dry-run] sẽ thêm `dm_station.line` (relation → dm_line, KHÔNG bắt buộc).');
  } else {
    await call('PATCH', `/api/collections/${stationCol.id}`, token, {
      fields: [...stationCol.fields, {
        name: 'line', type: 'relation',
        /* KHÔNG bắt buộc: 133 trạm hiện chưa có lộ, bắt buộc là chặn mọi thao
           tác sửa trạm cho tới khi khai xong hết lộ. */
        required: false, presentable: false,
        collectionId: lineCol.id, cascadeDelete: false, maxSelect: 1,
      }],
    });
    console.log('✔ Đã thêm `dm_station.line` (relation → dm_line, không bắt buộc).');
  }

  /* --------------------------- 3. đối chiếu --------------------------- */
  const st = await call('GET', '/api/collections/dm_station/records?perPage=1', token);
  const zn = await call('GET', '/api/collections/dm_zone/records?perPage=500', token);
  console.log(`\nHiện có ${zn.totalItems} KCN · ${st.totalItems} trạm`
    + `${DRY_RUN ? '' : ' · 0 lộ (chưa khai)'}.`);
  console.log('Trạm chưa gắn lộ sẽ nằm ở nhánh "Chưa gắn lộ" trong KCN của nó.');
}

main();
