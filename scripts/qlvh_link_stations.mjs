#!/usr/bin/env node
/**
 * Nối hợp đồng QLVH với TRẠM trong danh mục (`qlvh_contract.stations`).
 *
 *   node scripts/qlvh_link_stations.mjs                  # DRY-RUN, chỉ in ra
 *   node scripts/qlvh_link_stations.mjs --commit         # ghi thật
 *   node scripts/qlvh_link_stations.mjs --all [--commit] # nối cả ca nhập nhằng
 *   node scripts/qlvh_link_stations.mjs --undo --commit  # xoá sạch liên kết
 *
 * Biến môi trường: PB_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD.
 *
 * RANH GIỚI CỨNG (user chốt 21/08/2026): chỉ được GHI vào collection `qlvh_*`.
 * `dm_station` / `dm_customer` chỉ ĐỌC. Cưỡng chế bằng assertOwned().
 *
 * VÌ SAO MẶC ĐỊNH KHÔNG NỐI HẾT
 * -----------------------------
 * Quan hệ khách → trạm là 1-n, và khách → hợp đồng cũng là 1-n. Khi một khách
 * có NHIỀU trạm VÀ NHIỀU hợp đồng thì không có cách nào suy ra hợp đồng nào phủ
 * trạm nào — dữ liệu hiện tại không chứa thông tin đó (bảng khối lượng
 * `qlvh_item` đang rỗng). Gán bừa cả cụm trạm cho mọi hợp đồng là tạo ra dữ
 * liệu SAI trông như đúng, sau này không ai biết chỗ nào máy đoán chỗ nào người
 * nhập. Nên mặc định chỉ nối các ca KHÔNG THỂ NHẦM:
 *
 *   - khách chỉ có 1 trạm                → nối trạm đó
 *   - khách có nhiều trạm nhưng 1 hợp đồng → nối tất cả trạm của khách
 *
 * Còn lại in ra để người xử lý tay trên giao diện. `--all` bỏ chốt này (nối tất
 * cả trạm của khách cho mọi hợp đồng của khách đó) — chỉ dùng khi bạn đã xem
 * danh sách nhập nhằng và xác nhận đúng là như vậy.
 */

const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const COMMIT = process.argv.includes('--commit');
const ALL = process.argv.includes('--all');
const UNDO = process.argv.includes('--undo');
const PREFIX = 'qlvh_';

/* ---------------------------------------------------------------- chốt chặn */

function assertOwned(name, what) {
  if (typeof name !== 'string' || !name.startsWith(PREFIX)) {
    throw new Error(
      `CHẶN: từ chối ${what} trên collection "${name}". Script này chỉ được GHI vào ` +
      `collection có tiền tố "${PREFIX}". Danh mục dm_* là dữ liệu vận hành thật, chỉ được đọc.`
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
  token = (await api('/api/collections/_superusers/auth-with-password', {
    method: 'POST',
    body: JSON.stringify({ identity, password }),
  })).token;
}

/** Lấy hết bản ghi, không bị giới hạn 1 trang. */
async function allRecords(collection) {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await api(`/api/collections/${collection}/records?perPage=500&page=${page}`);
    out.push(...r.items);
    if (page >= r.totalPages || r.items.length === 0) break;
  }
  return out;
}

async function setStations(id, stations) {
  assertOwned(`${PREFIX}contract`, 'ghi');
  await api(`/api/collections/${PREFIX}contract/records/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ stations }),
  });
}

/* ------------------------------------------------------------------- chạy */

const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));

async function main() {
  console.log(`PocketBase: ${PB_URL}`);
  console.log(COMMIT ? 'CHẾ ĐỘ: GHI THẬT (--commit)' : 'CHẾ ĐỘ: DRY-RUN (thêm --commit để ghi thật)');
  if (ALL) console.log('PHẠM VI: --all — nối CẢ các ca nhập nhằng (nhiều trạm × nhiều hợp đồng)');
  if (UNDO) console.log('CHẾ ĐỘ: --undo — XOÁ toàn bộ liên kết trạm khỏi hợp đồng');

  await login();

  /* Trường `stations` phải tồn tại trước, nếu không PATCH sẽ âm thầm không ghi. */
  const coll = (await api(`/api/collections?perPage=200&fields=id,name`)).items
    .find(c => c.name === `${PREFIX}contract`);
  if (!coll) throw new Error(`Chưa có collection ${PREFIX}contract. Chạy qlvh_migrate.mjs trước.`);
  const full = await api(`/api/collections/${coll.id}`);
  if (!full.fields.some(f => f.name === 'stations')) {
    throw new Error(
      `Collection ${PREFIX}contract CHƯA có trường "stations".\n` +
      `Chạy trước: node scripts/qlvh_migrate.mjs --commit`
    );
  }

  const contracts = await allRecords(`${PREFIX}contract`);
  const stations = await allRecords('dm_station');
  const customers = await allRecords('dm_customer');
  const nameOf = new Map(customers.map(c => [c.id, c.name]));

  console.log(`\nHợp đồng: ${contracts.length} | Trạm trong danh mục: ${stations.length}`);

  if (UNDO) {
    const linked = contracts.filter(c => (c.stations || []).length > 0);
    console.log(`Sẽ xoá liên kết ở ${linked.length} hợp đồng.`);
    if (COMMIT) for (const c of linked) await setStations(c.id, []);
    console.log(COMMIT ? 'Đã xoá.' : '(dry-run — chưa xoá gì)');
    return;
  }

  /* Gom trạm và hợp đồng theo khách hàng. */
  const stByCust = new Map();
  for (const s of stations) {
    if (!s.customer) continue;
    if (!stByCust.has(s.customer)) stByCust.set(s.customer, []);
    stByCust.get(s.customer).push(s);
  }
  const ctByCust = new Map();
  for (const c of contracts) {
    if (!c.customer) continue;
    if (!ctByCust.has(c.customer)) ctByCust.set(c.customer, []);
    ctByCust.get(c.customer).push(c);
  }

  /**
   * Khách bị TRÙNG TÊN trong danh mục → mọi hợp đồng của họ đều ĐÁNG NGỜ.
   *
   * Hợp đồng được nhập từ Excel bằng cách khớp khách **theo tên**. Khi danh mục
   * có hai bản ghi cùng tên, phép khớp đó vớ phải bản nào là ngẫu nhiên — đã
   * thấy thật ngày 17/09: hai hợp đồng JOHNSON trỏ ngược nhau vì KCNTTI-004 và
   * KCNTTI-005 cùng mang tên "(THUẬN THÀNH 1)". Nối trạm dựa trên một liên kết
   * khách đã sai sẽ cho ra dữ liệu sai mà nhìn vẫn hợp lý, nên thà bỏ qua.
   */
  const byName = new Map();
  for (const c of customers) {
    const k = String(c.name || '').trim().toUpperCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(c);
  }
  const dupNameIds = new Set();
  for (const [, list] of byName) if (list.length > 1) for (const c of list) dupNameIds.add(c.id);

  const plan = [];            // sẽ nối
  const ambiguous = [];       // nhiều trạm × nhiều hợp đồng
  const dupName = [];         // khách trùng tên trong danh mục — liên kết không đáng tin
  const noStation = [];       // khách chưa có trạm nào trong danh mục
  const noCustomer = [];      // hợp đồng chưa nối dm_customer

  for (const c of contracts) {
    if (!c.customer) { noCustomer.push(c); continue; }
    if (dupNameIds.has(c.customer)) { dupName.push(c); continue; }
    const st = stByCust.get(c.customer) || [];
    if (st.length === 0) { noStation.push(c); continue; }

    const siblings = ctByCust.get(c.customer) || [];
    const unambiguous = st.length === 1 || siblings.length === 1;
    if (!unambiguous && !ALL) { ambiguous.push({ c, st, siblings: siblings.length }); continue; }

    const want = st.map(s => s.id);
    if (same(c.stations || [], want)) continue;   // đã đúng, không ghi lại
    plan.push({ c, want, codes: st.map(s => s.code) });
  }

  console.log(`\n── SẼ NỐI: ${plan.length} hợp đồng ──`);
  for (const p of plan) {
    console.log(`  ${p.c.contract_no}  [${nameOf.get(p.c.customer) || '?'}]`);
    console.log(`     → ${p.codes.join(', ')}`);
  }

  if (ambiguous.length) {
    console.log(`\n── BỎ QUA, CẦN NGƯỜI QUYẾT: ${ambiguous.length} hợp đồng ──`);
    console.log('   (khách có NHIỀU trạm VÀ NHIỀU hợp đồng — không suy ra được HĐ nào phủ trạm nào)');
    for (const a of ambiguous) {
      console.log(`  ${a.c.contract_no}  [${nameOf.get(a.c.customer) || '?'}]`);
      console.log(`     ${a.st.length} trạm: ${a.st.map(s => s.code).join(', ')} · khách có ${a.siblings} hợp đồng`);
    }
    console.log('   → gắn tay trên giao diện, hoặc chạy lại với --all nếu đúng là mỗi HĐ phủ tất cả trạm.');
  }

  if (dupName.length) {
    console.log(`\n── BỎ QUA, KHÁCH TRÙNG TÊN TRONG DANH MỤC: ${dupName.length} hợp đồng ──`);
    console.log('   (liên kết khách của hợp đồng không đáng tin → gắn trạm tay trên giao diện)');
    for (const c of dupName) {
      const cust = customers.find(x => x.id === c.customer);
      const twins = (byName.get(String(cust?.name || '').trim().toUpperCase()) || []).map(x => x.mkh);
      console.log(`  ${c.contract_no}`);
      console.log(`     đang trỏ ${cust?.mkh} — trùng tên với: ${twins.join(' + ')}`);
    }
  }

  if (noStation.length) {
    console.log(`\n── KHÁCH CHƯA CÓ TRẠM TRONG DANH MỤC: ${noStation.length} hợp đồng ──`);
    const byCust = new Map();
    for (const c of noStation) byCust.set(c.customer, (byCust.get(c.customer) || 0) + 1);
    for (const [cid, n] of byCust) console.log(`  ${nameOf.get(cid) || '?'} (${n} hợp đồng)`);
    console.log('   → bên Kho cần khai trạm cho các khách này trong Danh mục › Trạm.');
  }

  if (noCustomer.length) {
    console.log(`\n── HỢP ĐỒNG CHƯA NỐI DANH MỤC KHÁCH: ${noCustomer.length} ──`);
    for (const c of noCustomer) console.log(`  ${c.contract_no}  [${c.customer_name || '?'}]`);
    console.log('   → nối khách hàng trước thì mới gắn trạm được.');
  }

  if (COMMIT) {
    for (const p of plan) await setStations(p.c.id, p.want);
    console.log(`\nĐã ghi ${plan.length} hợp đồng.`);

    /* Đọc lại để CHỨNG MINH đã ghi, không tin vào việc PATCH trả 200. */
    const after = await allRecords(`${PREFIX}contract`);
    const ok = after.filter(c => (c.stations || []).length > 0).length;
    console.log(`Đối chiếu sau khi ghi: ${ok}/${after.length} hợp đồng đang có trạm.`);
  } else {
    console.log(`\n(dry-run — chưa ghi gì. Thêm --commit để ghi thật.)`);
  }
}

main().catch(err => { console.error(`\n${err.message}`); process.exit(1); });
