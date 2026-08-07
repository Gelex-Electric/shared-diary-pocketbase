/**
 * Chuẩn hoá tag trạng thái (user chốt 07/08).
 *
 *   Thiết bị  `wh_device.status`     → Trong kho | Đã treo | Thu hồi | Trả hàng
 *   Điểm đo   `wh_point.trang_thai`  → Dự kiến | Đang hoạt động | Chưa hoạt động | Đã thanh lý
 *
 * Chạy: PB_EMAIL=... PB_PASS=... node scripts/wh_tags.mjs [--commit]
 * Mặc định dry-run. Idempotent.
 *
 * THỨ TỰ BA BƯỚC, không đảo được:
 *   1. NỚI danh sách giá trị thành hợp của cũ và mới. Thiếu bước này thì
 *      PocketBase từ chối ghi ("Invalid value Chưa hoạt động") vì giá trị đích
 *      chưa nằm trong ô chọn — đã vấp thật khi chạy lần đầu.
 *   2. QUY ĐỔI bản ghi sang giá trị mới.
 *   3. THU HẸP danh sách còn đúng 4 giá trị.
 * Làm 3 trước 2 thì 49 điểm đo mang giá trị cũ rơi vào trạng thái không còn
 * tồn tại trong ô chọn: giao diện hiện trống, lần sửa kế tiếp là mất.
 *
 * Quy đổi điểm đo (user chốt):
 *   Chưa đóng điện   → Chưa hoạt động   (46 bản ghi)
 *   Không hoạt động  → Chưa hoạt động   (1)
 *   Đã thu hồi       → Đã thanh lý      (2)
 *   Đang hoạt động / Đã thanh lý        (giữ nguyên: 102 + 9)
 *
 * Thiết bị: cả 807 bản ghi đang để trống `status` nên không phải quy đổi gì.
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const DEVICE_STATUS = ['trong_kho', 'da_treo', 'thu_hoi', 'tra_hang'];
const POINT_STATUS = ['Dự kiến', 'Đang hoạt động', 'Chưa hoạt động', 'Đã thanh lý'];

const QUY_DOI_DIEM_DO = {
  'Chưa đóng điện': 'Chưa hoạt động',
  'Không hoạt động': 'Chưa hoạt động',
  'Đã thu hồi': 'Đã thanh lý',
  'Chưa gán khách hàng': 'Dự kiến',
  'Lưu tại chi nhánh': 'Chưa hoạt động',
  'Lưu tại văn phòng': 'Chưa hoạt động',
  'Trả Emic': 'Đã thanh lý',
};

async function datValues(col, field, values) {
  if (!col.name.startsWith('wh_')) throw new Error(`TU CHOI: ${col.name}`);
  const f = col.fields.find(x => x.name === field);
  if (!f) throw new Error(`${col.name} khong co truong ${field}`);
  const cu = (f.values || []).join('|');
  if (cu === values.join('|')) { console.log(`  ${col.name}.${field}: da dung danh sach`); return; }
  if (!COMMIT) {
    console.log(`  [dry-run] ${col.name}.${field}: ${f.values?.length ?? 0} gia tri -> ${values.length}`);
    return;
  }
  const fields = col.fields.map(x => (x.name === field ? { ...x, values } : x));
  await api('PATCH', `/api/collections/${col.id}`, { fields });
  console.log(`  ${col.name}.${field}: da dat ${values.length} gia tri`);
}

async function main() {
  token = (await api('POST', '/api/collections/_superusers/auth-with-password', {
    identity: PB_EMAIL, password: PB_PASS,
  })).token;
  console.log(`Da dang nhap superuser${COMMIT ? '' : '  [DRY-RUN]'}`);

  const list = await api('GET', '/api/collections?perPage=200');
  const byName = Object.fromEntries(list.items.map(c => [c.name, c]));

  // ---- 1. NOI danh sach = hop cua cu va moi, de buoc quy doi ghi duoc ----
  const truong = byName.wh_point.fields.find(f => f.name === 'trang_thai');
  const hop = [...new Set([...(truong.values || []), ...POINT_STATUS])];
  await datValues(byName.wh_point, 'trang_thai', hop);
  if (COMMIT) {
    // Doc lai de cac buoc sau lam viec tren dinh nghia moi nhat.
    const l2 = await api('GET', '/api/collections?perPage=200');
    byName.wh_point = l2.items.find(c => c.name === 'wh_point');
    byName.wh_device = l2.items.find(c => c.name === 'wh_device');
  }

  // ---- 2. QUY DOI BAN GHI DIEM DO ----
  const points = await api('GET', '/api/collections/wh_point/records?perPage=500');
  let doi = 0;
  for (const p of points.items) {
    const moi = QUY_DOI_DIEM_DO[p.trang_thai];
    if (!moi) continue;
    doi++;
    if (!COMMIT) { console.log(`  [dry-run] ${p.point_code}: "${p.trang_thai}" -> "${moi}"`); continue; }
    await api('PATCH', `/api/collections/wh_point/records/${p.id}`, { trang_thai: moi });
  }
  console.log(`  Diem do can quy doi: ${doi}${COMMIT ? ' (da doi)' : ''}`);

  // ---- 3. THU HEP DANH SACH GIA TRI ----
  await datValues(byName.wh_point, 'trang_thai', POINT_STATUS);
  await datValues(byName.wh_device, 'status', DEVICE_STATUS);

  // ---- 3. Doi chieu lai ----
  if (COMMIT) {
    const sau = await api('GET', '/api/collections/wh_point/records?perPage=500');
    const con = sau.items.filter(p => p.trang_thai && !POINT_STATUS.includes(p.trang_thai));
    console.log(`  Doi chieu: ${con.length} diem do con mang gia tri ngoai danh sach`);
    if (con.length) console.log('   ', con.slice(0, 5).map(p => `${p.point_code}="${p.trang_thai}"`).join(', '));
  }

  console.log(COMMIT ? 'Xong.' : 'Dry-run xong — them --commit de ghi that.');
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
