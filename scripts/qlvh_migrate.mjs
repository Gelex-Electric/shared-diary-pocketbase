#!/usr/bin/env node
/**
 * Tạo 2 collection của module QLVH (hợp đồng quản lý vận hành) trên PocketBase.
 *
 *   node scripts/qlvh_migrate.mjs            # DRY-RUN: chỉ in ra sẽ làm gì
 *   node scripts/qlvh_migrate.mjs --commit   # ghi thật
 *
 * Biến môi trường:
 *   PB_URL             (mặc định https://getc.up.railway.app/pb)
 *   PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD   — tài khoản superuser
 *
 * RANH GIỚI CỨNG (user chốt 21/08/2026): script chạy thẳng trên PB production,
 * chỉ được đụng collection có tiền tố `qlvh_`. Mọi collection sẵn có chỉ ĐỌC.
 * Ranh giới này cưỡng chế bằng assertOwned() ở mọi lời gọi ghi — không dựa vào
 * trí nhớ người chạy, vì một lệnh xoá nhầm trên production là mất dữ liệu thật.
 */

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const COMMIT = process.argv.includes('--commit');
const PREFIX = 'qlvh_';

/**
 * Danh mục dùng lại của app (CHỈ ĐỌC, không đụng vào):
 *   dm_customer — 100 khách hàng (mkh / name / short_name / zone)
 *   dm_zone     — 5 KCN (code / name)
 * Hợp đồng trỏ quan hệ tới hai bảng này thay vì chép tên khách/KCN thành chuỗi:
 * một nguồn sự thật, đổi tên khách ở danh mục thì hợp đồng không lệch theo.
 */
const CUSTOMER_COLLECTION = 'dm_customer';
const ZONE_COLLECTION = 'dm_zone';

/* ---------------------------------------------------------------- chốt chặn */

function assertOwned(name, what) {
  if (typeof name !== 'string' || !name.startsWith(PREFIX)) {
    throw new Error(
      `CHẶN: từ chối ${what} trên collection "${name}". Script này chỉ được đụng ` +
      `collection có tiền tố "${PREFIX}". Mọi collection khác là dữ liệu vận hành thật, chỉ được đọc.`
    );
  }
}

/* ------------------------------------------------------------------ PB API */

let token = '';

async function api(path, init = {}) {
  const res = await fetch(`${PB_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status}\n${JSON.stringify(body, null, 2)}`);
  }
  return body;
}

async function login() {
  const identity = process.env.PB_ADMIN_EMAIL;
  const password = process.env.PB_ADMIN_PASSWORD;
  if (!identity || !password) {
    throw new Error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD trong biến môi trường.');
  }
  const out = await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity, password }),
  });
  token = out.token;
}

/* -------------------------------------------------------------- định nghĩa */

/**
 * Quyền: khối Văn phòng (users.area rỗng) toàn quyền; khối Đội chỉ ĐỌC hợp đồng
 * thuộc KCN của mình. users.area là chuỗi có thể chứa nhiều KCN nên dùng `~`.
 */
const OFFICE_ONLY = '@request.auth.id != "" && @request.auth.area = ""';
const READ_CONTRACT = '@request.auth.id != "" && (@request.auth.area = "" || @request.auth.area ~ zone.name)';
const READ_PAYMENT = '@request.auth.id != "" && (@request.auth.area = "" || @request.auth.area ~ contract.zone.name)';

function contractFields(customerId, zoneId) {
  return [
  { name: 'contract_no',      type: 'text',   required: true },
  // Doanh nghiệp chế xuất (EPE) → thuế GTGT 0%. 20/70 hợp đồng trong file theo
  // dõi hiện hành thuộc diện này, nên để cờ riêng thay vì bắt nhớ chọn 0%.
  { name: 'che_xuat',         type: 'bool' },
  { name: 'customer',         type: 'relation', maxSelect: 1, cascadeDelete: false, collectionId: customerId },
  // Tên khách CHỤP LẠI lúc nhập: dùng khi khách chưa có trong dm_customer (nhập
  // từ file theo dõi có 8 khách như vậy) và làm dấu vết đối chiếu về sau.
  { name: 'customer_name',    type: 'text' },
  { name: 'zone',             type: 'relation', maxSelect: 1, cascadeDelete: false, collectionId: zoneId },
  { name: 'sign_date',        type: 'date' },
  { name: 'effective_from',   type: 'date' },
  { name: 'effective_to',     type: 'date' },
  { name: 'value_before_vat', type: 'number' },
  { name: 'vat_rate',         type: 'number' },
  { name: 'value_vat',        type: 'number' },
  { name: 'value_total',      type: 'number' },
  { name: 'payment_terms',    type: 'text' },
  // 'du_thao' = hợp đồng chưa có số / chưa ký, nhập trước để giữ chỗ; KHÔNG tính
  // vào công nợ. Thêm giá trị vào ô chọn là NỚI danh sách — an toàn; thu hẹp mới
  // nguy hiểm (bản ghi cũ rơi vào giá trị không còn tồn tại).
  { name: 'status_manual',    type: 'select', maxSelect: 1, values: ['du_thao', 'dang_hieu_luc', 'tam_dung', 'da_thanh_ly'] },
  { name: 'note',             type: 'text' },
  { name: 'created',          type: 'autodate', onCreate: true,  onUpdate: false },
  { name: 'updated',          type: 'autodate', onCreate: true,  onUpdate: true  },
  ];
}

/**
 * Bảng con: khối lượng & đơn giá — đúng "Phụ lục 01" của hợp đồng.
 *
 * Đây là CƠ SỞ hình thành giá trị hợp đồng (vd: cáp ngầm 22kV 20m × 4.438đ/m/năm
 * + MBA 400kVA 1 máy × 19.196.955đ/máy/năm = 19.285.715đ/năm). Điều 11.2 của hợp
 * đồng quy định khối lượng thay đổi thì phải ký phụ lục, nên phần này phải nằm
 * trong hệ thống chứ không để trong file Word.
 *
 * Đơn giá tính THEO NĂM; giá trị hợp đồng = tổng/năm × (thời hạn / 12).
 */
function itemFields(contractId) {
  return [
    { name: 'contract',   type: 'relation', required: true, maxSelect: 1, cascadeDelete: true, collectionId: contractId },
    { name: 'seq',        type: 'number' },
    { name: 'content',    type: 'text' },
    { name: 'unit',       type: 'text' },   // ĐVT: m/năm, máy/năm...
    { name: 'qty',        type: 'number' },
    { name: 'unit_price', type: 'number' },
    { name: 'amount',     type: 'number' }, // = qty × unit_price, lưu sẵn cho báo cáo
    { name: 'note',       type: 'text' },
    { name: 'created',    type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated',    type: 'autodate', onCreate: true, onUpdate: true },
  ];
}

/** Bảng con: n đợt / hợp đồng. KHÔNG có field trạng thái — trạng thái là dẫn xuất. */
function paymentFields(contractId) {
  return [
    { name: 'contract',    type: 'relation', required: true, maxSelect: 1, cascadeDelete: true, collectionId: contractId },
    { name: 'seq',         type: 'number' },
    { name: 'due_date',    type: 'date' },
    { name: 'pct',         type: 'number' },
    { name: 'amount_due',  type: 'number' },
    { name: 'paid_date',   type: 'date' },
    { name: 'amount_paid', type: 'number' },
    { name: 'invoice_no',  type: 'text' },
    { name: 'note',        type: 'text' },
    { name: 'created',     type: 'autodate', onCreate: true, onUpdate: false },
    { name: 'updated',     type: 'autodate', onCreate: true, onUpdate: true  },
  ];
}

/* ------------------------------------------------------------------- chạy */

async function ensureCollection(def) {
  assertOwned(def.name, 'tạo/sửa');
  const existing = await api(`/api/collections?perPage=200&fields=id,name`)
    .then(r => r.items.find(c => c.name === def.name));

  if (existing) {
    // Collection đã có: KHÔNG ghi đè, chỉ BỔ SUNG field còn thiếu. Ghi đè cả
    // định nghĩa là mất dữ liệu của field không nằm trong bản mới.
    const full = await api(`/api/collections/${existing.id}`);
    const have = new Map(full.fields.map(f => [f.name, f]));
    const missing = def.fields.filter(f => !have.has(f.name));

    /* Ô chọn được NỚI thêm giá trị (không bao giờ thu hẹp ở đây). */
    const widened = [];
    const fields = full.fields.map(f => {
      const want = def.fields.find(d => d.name === f.name);
      if (!want || want.type !== 'select' || !Array.isArray(want.values)) return f;
      const add = want.values.filter(v => !(f.values || []).includes(v));
      if (add.length === 0) return f;
      widened.push(`${f.name} += ${add.join(',')}`);
      return { ...f, values: [...(f.values || []), ...add] };
    });

    if (missing.length === 0 && widened.length === 0) {
      console.log(`  ✓ đã tồn tại, đủ field: ${def.name} (${existing.id})`);
      return existing.id;
    }
    const what = [
      missing.length ? `thêm field → ${missing.map(f => f.name).join(', ')}` : '',
      widened.length ? `nới ô chọn → ${widened.join('; ')}` : '',
    ].filter(Boolean).join(' | ');
    console.log(`  ~ ${COMMIT ? '' : '[dry-run] '}${def.name}: ${what}`);
    if (COMMIT) {
      await api(`/api/collections/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: [...fields, ...missing] }),
      });
    }
    return existing.id;
  }
  if (!COMMIT) {
    console.log(`  + [dry-run] sẽ tạo: ${def.name} (${def.fields.length} field)`);
    return `DRYRUN_${def.name}`;
  }
  const out = await api('/api/collections', { method: 'POST', body: JSON.stringify(def) });
  console.log(`  + đã tạo: ${out.name} (${out.id})`);
  return out.id;
}

async function main() {
  console.log(`PocketBase: ${PB_URL}`);
  console.log(COMMIT ? 'CHẾ ĐỘ: GHI THẬT (--commit)' : 'CHẾ ĐỘ: DRY-RUN (thêm --commit để ghi thật)');

  await login();

  const all = (await api('/api/collections?perPage=200&fields=id,name')).items;
  const before = all.map(c => c.name).sort();
  console.log(`\nCollection hiện có (${before.length}): ${before.join(', ')}`);
  console.log('→ Toàn bộ danh sách trên là CHỈ ĐỌC. Script chỉ tạo thêm collection qlvh_*.\n');

  const idOf = (name) => {
    const c = all.find(x => x.name === name);
    if (!c) throw new Error(`Không tìm thấy danh mục "${name}" trên PB — cần có trước khi tạo hợp đồng.`);
    return c.id;
  };
  const customerId = idOf(CUSTOMER_COLLECTION);
  const zoneId = idOf(ZONE_COLLECTION);
  console.log(`Quan hệ dùng lại: ${CUSTOMER_COLLECTION} (${customerId}), ${ZONE_COLLECTION} (${zoneId})\n`);

  const contractId = await ensureCollection({
    name: `${PREFIX}contract`,
    type: 'base',
    fields: contractFields(customerId, zoneId),
    indexes: [`CREATE UNIQUE INDEX idx_qlvh_contract_no ON ${PREFIX}contract (contract_no)`],
    listRule: READ_CONTRACT,
    viewRule: READ_CONTRACT,
    createRule: OFFICE_ONLY,
    updateRule: OFFICE_ONLY,
    deleteRule: OFFICE_ONLY,
  });

  await ensureCollection({
    name: `${PREFIX}item`,
    type: 'base',
    fields: itemFields(contractId),
    indexes: [`CREATE INDEX idx_qlvh_item_contract ON ${PREFIX}item (contract)`],
    listRule: READ_PAYMENT,
    viewRule: READ_PAYMENT,
    createRule: OFFICE_ONLY,
    updateRule: OFFICE_ONLY,
    deleteRule: OFFICE_ONLY,
  });

  await ensureCollection({
    name: `${PREFIX}payment`,
    type: 'base',
    fields: paymentFields(contractId),
    indexes: [`CREATE INDEX idx_qlvh_payment_contract ON ${PREFIX}payment (contract)`],
    listRule: READ_PAYMENT,
    viewRule: READ_PAYMENT,
    createRule: OFFICE_ONLY,
    updateRule: OFFICE_ONLY,
    deleteRule: OFFICE_ONLY,
  });

  const after = (await api('/api/collections?perPage=200&fields=id,name')).items.map(c => c.name).sort();
  const lost = before.filter(n => !after.includes(n));
  if (lost.length) throw new Error(`BÁO ĐỘNG: collection biến mất sau khi chạy: ${lost.join(', ')}`);
  console.log(`\nĐối chiếu: ${before.length} collection cũ còn nguyên ${lost.length === 0 ? '✓' : '✗'}; tổng sau khi chạy: ${after.length}`);
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
