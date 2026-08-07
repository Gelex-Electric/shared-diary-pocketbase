/**
 * Thêm trường `note` (ghi chú) vào `wh_customer` — user chốt 07/08 khi định
 * lại các cột của bảng khách hàng: MKH, Tên khách hàng, KCN, Tên tắt,
 * Trạng thái, Ghi chú.
 *
 * Chạy: PB_EMAIL=... PB_PASS=... node scripts/wh_customer_note.mjs [--commit]
 * Mặc định dry-run. CHỈ THÊM trường, giữ nguyên toàn bộ trường cũ. Idempotent.
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

async function main() {
  token = (await api('POST', '/api/collections/_superusers/auth-with-password', {
    identity: PB_EMAIL, password: PB_PASS,
  })).token;

  const list = await api('GET', '/api/collections?perPage=200');
  const col = list.items.find(c => c.name === 'wh_customer');
  if (!col) throw new Error('Khong tim thay wh_customer');
  if (!col.name.startsWith('wh_')) throw new Error('TU CHOI: khong phai collection wh_');

  if (col.fields.some(f => f.name === 'note')) {
    console.log('wh_customer da co truong note — khong lam gi.');
    return;
  }
  if (!COMMIT) {
    console.log('[dry-run] se them truong note vao wh_customer');
    return;
  }
  // NOI THEM vao cuoi, giu nguyen truong cu.
  await api('PATCH', `/api/collections/${col.id}`, {
    fields: [...col.fields, { name: 'note', type: 'text', required: false }],
  });
  console.log('da them truong note vao wh_customer');
}

main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
