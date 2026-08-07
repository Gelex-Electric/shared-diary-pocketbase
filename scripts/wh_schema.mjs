/**
 * Task 1 — Tao schema PocketBase cho mang Quan ly kho thiet bi.
 * Plan: plans/2026-08-06-quan-ly-kho-thiet-bi.md (muc 5).
 *
 * Chay:
 *   PB_URL=... PB_EMAIL=... PB_PASS=... node scripts/wh_schema.mjs [--dry-run] [--drop]
 *
 * KHONG hardcode credentials trong file nay (repo PUBLIC).
 *
 * Idempotent: collection da ton tai thi PATCH lai fields/rules, khong tao trung.
 * Thu tu tao quan trong: bang duoc tham chieu phai co truoc (relation can collectionId).
 */

const PB_URL = (process.env.PB_URL || '').replace(/\/$/, '');
const PB_EMAIL = process.env.PB_EMAIL || '';
const PB_PASS = process.env.PB_PASS || '';
const DRY = process.argv.includes('--dry-run');
const DROP = process.argv.includes('--drop');

if (!PB_URL || !PB_EMAIL || !PB_PASS) {
  console.error('Thieu PB_URL / PB_EMAIL / PB_PASS trong bien moi truong.');
  process.exit(1);
}

/** 6 KCN — 5 KCN thuc + kho van phong GETC (plan muc 3.1). */
const ZONES = ['KCN Tiền Hải', 'KCN Phong Điền', 'KCN Thuận Thành I',
  'KCN Yên Mỹ', 'KCN Số 3', 'GETC'];

/** Trang thai diem do — 9 gia tri dang dung thuc te trong Excel goc. */
const POINT_STATUS = ['Đang hoạt động', 'Chưa đóng điện', 'Chưa gán khách hàng',
  'Không hoạt động', 'Lưu tại chi nhánh', 'Lưu tại văn phòng',
  'Đã thu hồi', 'Đã thanh lý', 'Trả Emic'];

/** Quyen: doc = da dang nhap; ghi = khoi kinh doanh (users.area rong). */
const READ = '@request.auth.id != ""';
const WRITE = '@request.auth.id != "" && @request.auth.area = ""';

const txt = (name, required = false) => ({ name, type: 'text', required });
const num = (name) => ({ name, type: 'number', required: false });
const bool = (name) => ({ name, type: 'bool', required: false });
const date = (name) => ({ name, type: 'date', required: false });
const sel = (name, values, required = false) =>
  ({ name, type: 'select', required, maxSelect: 1, values });
const rel = (name, collectionId, required = false) =>
  ({ name, type: 'relation', required, collectionId, maxSelect: 1, cascadeDelete: false });

/**
 * Dinh nghia 6 collection. `rels` khai bao quan he theo TEN collection,
 * duoc doi sang collectionId luc chay (PocketBase yeu cau id, khong nhan ten).
 */
function buildDefs(idOf) {
  return [
    {
      name: 'wh_warehouse',      // 6 kho: moi KCN 1 kho + kho van phong GETC
      fields: [
        txt('code', true), txt('name', true),
        sel('zone', ZONES, true),
        bool('active'),
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_warehouse_code` ON `wh_warehouse` (`code`)'],
    },
    {
      name: 'wh_device_type',    // CONGTO | TI | TU | GP03 | SIM
      fields: [
        txt('code', true), txt('name', true),
        bool('required_at_point'),
        num('max_per_point'),
        bool('has_calibration'),
        num('order_index'),
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_device_type_code` ON `wh_device_type` (`code`)'],
    },
    {
      name: 'wh_customer',       // khach hang theo MKH
      fields: [
        txt('mkh', true), txt('ten', true), txt('tat'),
        sel('zone', ZONES),
        txt('trang_thai'),
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_customer_mkh` ON `wh_customer` (`mkh`)'],
    },
    {
      name: 'wh_point',          // diem do — point_code giu nguyen ma Excel
      fields: [
        txt('point_code', true),
        rel('customer', idOf('wh_customer')),
        sel('zone', ZONES),
        txt('mba'), num('cong_suat_kva'),
        date('ngay_dong_dien'), date('ngay_thanh_ly'),
        sel('trang_thai', POINT_STATUS),
        // De trong o giai doan 1 — danh cho Lo/Tram khi co du lieu (plan 3.3)
        txt('line_name'), txt('station_code'),
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_point_code` ON `wh_point` (`point_code`)'],
    },
    {
      name: 'wh_device',         // thiet bi theo serial
      fields: [
        txt('serial', true),
        rel('type', idOf('wh_device_type'), true),
        txt('model'),            // ME41 (gian tiep, can TI) | ME42 (truc tiep, HSN=1)
        txt('spec'),             // ty so TI, vd 1600/5
        txt('manufacturer'), num('year_made'),
        date('calib_date'), date('calib_expiry'), txt('calib_cert_no'),
        sel('nguon_goc', ['du_phong', 'thu_hoi']),
        txt('note'),
        // ---- Truong DAN XUAT tu wh_movement — KHONG co UI sua tay ----
        sel('status', ['trong_kho', 'dang_treo', 'da_thu_hoi', 'da_xuat_kho', 'thanh_ly']),
        rel('current_warehouse', idOf('wh_warehouse')),
        rel('current_point', idOf('wh_point')),
        // ---- Co chat luong du lieu ----
        bool('tu_dong_tao'),     // sinh tu giao dich, chua co trong danh muc goc
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_wh_device_serial` ON `wh_device` (`serial`)'],
    },
    {
      name: 'wh_movement',       // so nhat ky — append-only, khong cho xoa
      noDelete: true,
      fields: [
        rel('device', idOf('wh_device'), true),
        sel('action', ['nhap_kho', 'chuyen_kho', 'treo', 'thao', 'xuat_kho', 'thanh_ly'], true),
        date('event_date', true),
        rel('from_warehouse', idOf('wh_warehouse')),
        rel('to_warehouse', idOf('wh_warehouse')),
        rel('from_point', idOf('wh_point')),
        rel('to_point', idOf('wh_point')),
        num('chi_so'),           // chi so cong to luc treo/thao
        txt('reason'), txt('doc_no'), txt('performer'), txt('note'),
        txt('img_path'),         // giai doan 1 chi luu duong dan (plan cau 3)
        bool('can_review'),      // suy dien khong chac chan -> can nguoi xac nhan
        txt('created_by'),
      ],
      indexes: [
        'CREATE INDEX `idx_wh_movement_device` ON `wh_movement` (`device`, `event_date`)',
        'CREATE INDEX `idx_wh_movement_date` ON `wh_movement` (`event_date`)',
      ],
    },
  ];
}

/** Thu tu tao: bang duoc tham chieu phai dung truoc bang tham chieu no. */
const ORDER = ['wh_warehouse', 'wh_device_type', 'wh_customer', 'wh_point',
  'wh_device', 'wh_movement'];

// ==================== PocketBase client ====================

async function api(token, path, opts = {}) {
  const res = await fetch(`${PB_URL}/api${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}), ...opts.headers },
  });
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = body; }
  if (!res.ok) {
    const err = new Error(`${res.status} ${path}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function login() {
  for (const coll of ['_superusers', 'users']) {
    try {
      const r = await api('', `/collections/${coll}/auth-with-password`, {
        method: 'POST', body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASS }),
      });
      if (r.token) { console.log(`Dang nhap OK qua \`${coll}\``); return r.token; }
    } catch { /* thu collection tiep theo */ }
  }
  throw new Error('Dang nhap PocketBase that bai (ca _superusers lan users).');
}

async function listCollections(token) {
  const r = await api(token, '/collections?perPage=200');
  return Object.fromEntries(r.items.map(c => [c.name, c]));
}

// ==================== Main ====================

const token = await login();
console.log(`PocketBase: ${PB_URL}`);
if (DRY) console.log('*** DRY-RUN: khong ghi gi len server ***');

let existing = await listCollections(token);

if (DROP) {
  // Xoa nguoc thu tu de khong vuong rang buoc relation.
  for (const name of [...ORDER].reverse()) {
    if (!existing[name]) continue;
    console.log(`  [drop] ${name}`);
    if (!DRY) await api(token, `/collections/${existing[name].id}`, { method: 'DELETE' });
  }
  existing = DRY ? existing : await listCollections(token);
}

const created = [];
for (const name of ORDER) {
  // idOf tra ve id that neu collection da ton tai; luc dry-run co the chua co.
  const idOf = (n) => (existing[n]?.id) || '';
  const def = buildDefs(idOf).find(d => d.name === name);

  const payload = {
    name: def.name,
    type: 'base',
    fields: def.fields,
    indexes: def.indexes || [],
    listRule: READ,
    viewRule: READ,
    createRule: WRITE,
    updateRule: def.noDelete ? WRITE : WRITE,
    deleteRule: def.noDelete ? null : WRITE,   // null = chi superuser
  };

  const missingRel = def.fields.filter(f => f.type === 'relation' && !f.collectionId);
  if (missingRel.length) {
    const msg = `${name}: thieu collectionId cho relation ${missingRel.map(f => f.name).join(', ')}`;
    if (DRY) { console.log(`  [dry] ${msg} (se co sau khi tao bang truoc do)`); }
    else throw new Error(msg);
  }

  if (existing[name]) {
    console.log(`  [update] ${name} (${def.fields.length} fields)`);
    if (!DRY) await api(token, `/collections/${existing[name].id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  } else {
    console.log(`  [create] ${name} (${def.fields.length} fields)`);
    if (!DRY) {
      const c = await api(token, '/collections', { method: 'POST', body: JSON.stringify(payload) });
      existing[name] = c;
      created.push(name);
    }
  }
}

// ==================== Kiem chung ====================
if (!DRY) {
  const after = await listCollections(token);
  console.log('\n--- Kiem chung ---');
  let ok = true;
  for (const name of ORDER) {
    const c = after[name];
    if (!c) { console.log(`  X ${name}: KHONG TON TAI`); ok = false; continue; }
    const def = buildDefs((n) => after[n]?.id || '').find(d => d.name === name);
    const have = new Set(c.fields.map(f => f.name));
    const miss = def.fields.filter(f => !have.has(f.name)).map(f => f.name);
    const delRule = c.deleteRule === null ? 'chi superuser' : c.deleteRule;
    console.log(`  ${miss.length ? 'X' : 'v'} ${name}: ${c.fields.length} fields` +
      `${miss.length ? ' | THIEU: ' + miss.join(',') : ''} | delete=${delRule}`);
    if (miss.length) ok = false;
  }
  console.log(ok ? '\nTat ca collection dung schema.' : '\nCO LOI — xem dong danh dau X o tren.');
  process.exit(ok ? 0 : 1);
}
