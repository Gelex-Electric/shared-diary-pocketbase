/**
 * Bỏ bảng kho: mỗi KCN đúng một kho nên `wh_zone` gánh luôn vai trò đó
 * (user chốt 07/08). Kho trung chuyển chính là đơn vị `GETC` đã có sẵn.
 *
 * Chạy:
 *   PB_EMAIL=... PB_PASS=... node scripts/wh_drop_warehouse.mjs [--commit]
 * MẶC ĐỊNH DRY-RUN.
 *
 * Việc script làm, theo đúng thứ tự:
 *   1. Thêm `short_code` + `warehouse_name` vào `wh_zone`, đổ từ `wh_warehouse`.
 *   2. Thêm `zone` (relation → wh_zone) vào `wh_device` thay `current_warehouse`.
 *   3. Thêm `from_zone` / `to_zone` vào `wh_movement`.
 *   4. Xoá các trường trỏ tới kho, rồi XOÁ collection `wh_warehouse`.
 *
 * VÌ SAO ĐƯỢC PHÉP XOÁ: đọc thật trước khi xoá — 0 thiết bị có
 * `current_warehouse`, 0 dòng trong `wh_movement`. Script TỰ KIỂM TRA lại điều
 * này lúc chạy và DỪNG nếu khác, để không bao giờ xoá đè lên dữ liệu thật.
 *
 * Mã ngắn (TH / PĐ / TTI / YM / 03 / GETC) chỉ để hiển thị. Khoá nối vẫn là
 * `wh_zone.code` = chuỗi dài ("KCN Tiền Hải"), vì 160 điểm đo đang mang đúng
 * chuỗi đó ở `wh_point.zone`; đổi khoá là phải sửa cả 160 bản ghi mà không lợi
 * thêm gì.
 */

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_EMAIL || '';
const PB_PASS = process.env.PB_PASS || '';
const COMMIT = process.argv.includes('--commit');

if (!PB_EMAIL || !PB_PASS) { console.error('Thieu PB_EMAIL / PB_PASS.'); process.exit(1); }

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

function guard(name) {
  if (!name.startsWith('wh_')) throw new Error(`TU CHOI: "${name}" khong mang tien to wh_`);
}

const txt = (name) => ({ name, type: 'text', required: false });
const rel = (name, collectionId) =>
  ({ name, type: 'relation', required: false, collectionId, maxSelect: 1, cascadeDelete: false });

async function addFields(col, defs) {
  guard(col.name);
  const has = new Set(col.fields.map(f => f.name));
  const them = defs.filter(f => !has.has(f.name));
  if (!them.length) { console.log(`  ${col.name}: da du truong`); return col; }
  if (!COMMIT) { console.log(`  [dry-run] ${col.name}: se them ${them.map(f => f.name).join(', ')}`); return col; }
  const out = await api('PATCH', `/api/collections/${col.id}`, { fields: [...col.fields, ...them] });
  console.log(`  ${col.name}: da them ${them.map(f => f.name).join(', ')}`);
  return out;
}

async function dropFields(col, names) {
  guard(col.name);
  const con = col.fields.filter(f => !names.includes(f.name));
  const bo = col.fields.length - con.length;
  if (!bo) { console.log(`  ${col.name}: khong con truong nao can bo`); return col; }
  if (!COMMIT) { console.log(`  [dry-run] ${col.name}: se bo ${names.join(', ')}`); return col; }
  const out = await api('PATCH', `/api/collections/${col.id}`, { fields: con });
  console.log(`  ${col.name}: da bo ${names.join(', ')}`);
  return out;
}

async function main() {
  token = (await api('POST', '/api/collections/_superusers/auth-with-password', {
    identity: PB_EMAIL, password: PB_PASS,
  })).token;
  console.log(`Da dang nhap superuser${COMMIT ? '' : '  [DRY-RUN]'}`);

  const list = await api('GET', '/api/collections?perPage=200');
  const byName = Object.fromEntries(list.items.map(c => [c.name, c]));
  for (const n of ['wh_zone', 'wh_device', 'wh_movement']) {
    if (!byName[n]) throw new Error(`Thieu collection ${n}`);
  }

  // ---- CHOT AN TOAN: chi xoa khi that su chua co du lieu ----
  const dungKho = await api('GET', `/api/collections/wh_device/records?perPage=1&filter=${encodeURIComponent("current_warehouse!=''")}`);
  const soGiaoDich = await api('GET', '/api/collections/wh_movement/records?perPage=1');
  console.log(`Kiem tra: ${dungKho.totalItems} thiet bi dang tro toi kho, ${soGiaoDich.totalItems} giao dich trong so.`);
  if (dungKho.totalItems > 0 || soGiaoDich.totalItems > 0) {
    throw new Error('DUNG: da co du lieu tro toi kho. Phai chuyen du lieu truoc khi bo bang kho.');
  }

  // ---- 1. wh_zone: them mo ta kho ----
  let zone = await addFields(byName.wh_zone, [txt('short_code'), txt('warehouse_name')]);

  if (byName.wh_warehouse) {
    const kho = await api('GET', '/api/collections/wh_warehouse/records?perPage=50');
    const zones = await api('GET', '/api/collections/wh_zone/records?perPage=50');
    for (const w of kho.items) {
      const z = zones.items.find(x => x.code === w.zone);
      if (!z) { console.log(`  ! khong khop kho ${w.code} voi don vi nao`); continue; }
      if (!COMMIT) { console.log(`  [dry-run] ${z.code} <- short_code=${w.code}`); continue; }
      await api('PATCH', `/api/collections/wh_zone/records/${z.id}`, {
        short_code: w.code, warehouse_name: w.name,
      });
      console.log(`  ${z.code} <- short_code=${w.code}`);
    }
  }

  // ---- 2 & 3. Truong thay the ----
  let device = await addFields(byName.wh_device, [rel('zone', zone.id || byName.wh_zone.id)]);
  let movement = await addFields(byName.wh_movement, [
    rel('from_zone', zone.id || byName.wh_zone.id),
    rel('to_zone', zone.id || byName.wh_zone.id),
  ]);

  // ---- 4. Bo truong tro toi kho, roi bo bang kho ----
  device = await dropFields(device, ['current_warehouse']);
  movement = await dropFields(movement, ['from_warehouse', 'to_warehouse']);

  if (byName.wh_warehouse) {
    guard('wh_warehouse');
    if (!COMMIT) {
      console.log('  [dry-run] se XOA collection wh_warehouse');
    } else {
      await api('DELETE', `/api/collections/${byName.wh_warehouse.id}`);
      console.log('  da XOA collection wh_warehouse');
    }
  } else {
    console.log('  wh_warehouse da khong con');
  }

  console.log(COMMIT ? 'Xong.' : 'Dry-run xong — them --commit de ghi that.');
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
