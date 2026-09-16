#!/usr/bin/env node
/**
 * Thêm cột `kind` vào collection `notifications` + backfill bản ghi cũ.
 *
 * Vì sao cần: màn Thông báo chia sub-side theo NHÓM nghiệp vụ, mà `type` hiện có
 * quá thô — ba loại cảnh báo khác hẳn nhau (HSN sai, dữ liệu trạm, đối chiếu
 * công tơ) đều mang `type = 'info'`. `type` giữ nguyên vai trò cũ: quyết định
 * màu và biểu tượng.
 *
 * Giá trị `kind`:
 *   thanhtoan · hsn · tram · congto · lui · '' (chưa phân nhóm)
 *
 * Backfill: mọi bản ghi đang có đều là `type = 'payment'` (khách hàng thanh
 * toán) → `kind = 'thanhtoan'`. KHÔNG đoán mò bản ghi nào khác; `type` khác thì
 * để trống cho vào mục "Khác", người dùng còn thấy mà xử lý.
 *
 * CHỈ đụng collection `notifications`: thêm một cột và ghi giá trị cột đó. Không
 * sửa cột nào đang có, không xoá bản ghi nào, không chạm collection khác.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/notif_kind_schema.mjs --dry-run
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/notif_kind_schema.mjs
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || process.env.PB_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || process.env.PB_PASS || '';
const DRY_RUN = process.argv.includes('--dry-run');

const NAME = 'notifications';
const FIELD = 'kind';

/** `type` cũ → `kind` mới. Chỉ những ánh xạ CHẮC CHẮN, không suy đoán. */
const BACKFILL = { payment: 'thanhtoan' };

async function call(method, path, token, body) {
  const res = await fetch(`${PB_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`HTTP ${res.status} ${method} ${path}\n${text.slice(0, 300)}`); process.exit(1); }
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('Thiếu PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD (hoặc PB_EMAIL/PB_PASS)');
    process.exit(1);
  }
  const { token } = await call('POST', '/api/collections/_superusers/auth-with-password',
    null, { identity: EMAIL, password: PASSWORD });

  const list = await call('GET', '/api/collections?perPage=500', token);
  const col = list.items.find(c => c.name === NAME);
  if (!col) { console.error(`Không thấy collection ${NAME} — dừng.`); process.exit(1); }

  const fields = col.fields ?? col.schema;
  console.log(`PB: ${PB_URL}`);
  console.log(`${NAME} đang có: ${fields.map(f => f.name).join(', ')}`);

  /* ------------------------- 1. thêm cột ------------------------- */
  if (fields.some(f => f.name === FIELD)) {
    console.log(`\n\`${FIELD}\` đã có — bỏ qua bước tạo cột.`);
  } else if (DRY_RUN) {
    console.log(`\n[dry-run] sẽ thêm cột \`${FIELD}\` (text, không bắt buộc) vào ${NAME}`);
  } else {
    await call('PATCH', `/api/collections/${col.id}`, token, {
      fields: [...fields, { name: FIELD, type: 'text', required: false, presentable: false }],
    });
    console.log(`\n✔ Đã thêm cột \`${FIELD}\``);
  }

  /* ------------------------- 2. backfill ------------------------- */
  const records = [];
  for (let page = 1; ; page++) {
    const r = await call('GET', `/api/collections/${NAME}/records?perPage=500&page=${page}`, token);
    records.push(...r.items);
    if (page >= (r.totalPages ?? 1)) break;
  }
  console.log(`\n${NAME} có ${records.length} bản ghi.`);

  const byType = new Map();
  for (const r of records) byType.set(r.type || '(rỗng)', (byType.get(r.type || '(rỗng)') ?? 0) + 1);
  for (const [t, n] of byType) {
    console.log(`   type=${String(t).padEnd(10)} ${String(n).padStart(4)} → kind=${BACKFILL[t] ?? '(để trống)'}`);
  }

  let done = 0, skipped = 0;
  for (const rec of records) {
    const want = BACKFILL[rec.type];
    /* Không có ánh xạ chắc chắn, hoặc đã đúng rồi → không đụng vào. */
    if (!want || rec[FIELD] === want) { skipped++; continue; }
    if (!DRY_RUN) {
      await call('PATCH', `/api/collections/${NAME}/records/${rec.id}`, token, { [FIELD]: want });
    }
    done++;
  }
  console.log(DRY_RUN
    ? `\n[dry-run] sẽ gán kind cho ${done} bản ghi, bỏ qua ${skipped}.`
    : `\n✔ Đã gán kind cho ${done} bản ghi, bỏ qua ${skipped}.`);
}

main();
