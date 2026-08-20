#!/usr/bin/env node
/**
 * Thêm khách hàng mới vào `dm_customer` theo danh sách user cung cấp 20/08/2026
 * (danh sách chính thức, gồm cả khách chuẩn bị mua điện nên chưa có hóa đơn).
 *
 * CHỈ TẠO KHÁCH MỚI. Không sửa tên, không sửa mã, không xoá — user chốt: danh
 * sách tay chỉ dùng cho khách MỚI, khách đã có giữ nguyên tên theo hóa đơn.
 *
 * NHỮNG DÒNG BỊ LOẠI KHỎI DANH SÁCH (user chốt từng cái):
 *
 * 1. `GETC` và 5 mã `*-000` (Văn phòng KCN) — user yêu cầu bỏ.
 *
 * 2. Năm mã đổi hậu tố "A" — GIỮ MÃ CÓ "A" theo hóa đơn, vì `invoice.MKHang`
 *    vẫn ghi mã cũ; đổi sang mã mới là mất đối chiếu HSN và vòng đời vật tư:
 *      KCN03-002  ⟵ đã có KCN03-002A  (XÂY DỰNG SỐ 1)
 *      KCN03-003  ⟵ đã có KCN03-003A  (AN TÂM)
 *      KCNTH-009  ⟵ đã có KCNTH-009A  (HỢP NHẤT)
 *      KCNTH-010  ⟵ đã có KCNTH-010A  (SAUSUM)
 *      KCNYM-002  ⟵ đã có KCNYM-002A  (LIHUA)
 *
 * 3. `KCNTH-003A` ghi là "CƠ ĐIỆN HỢP LỰC" — user xác nhận GÕ NHẦM. Thực tế
 *    KCNTH-003 = Hợp Lực, KCNTH-003A = BE BRIGHT (25 hóa đơn, 2 trạm). Giữ nguyên.
 *
 * 4. `KCNTTI-010` ghi là "NGÂN AN" nhưng PB đang là CESE2 (2 hóa đơn) —
 *    user đang xác minh lại. Vì thế 2 trạm `TTI.NGÂN AN` CHƯA khai được.
 *
 * Chạy:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_import_customers.mjs
 *   … thêm --apply để ghi thật
 */
const PB_URL = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const APPLY = process.argv.includes('--apply');

/**
 * Khách hàng cần tạo.
 *
 * `short` chỉ điền cho khách đã có trạm trong `public/mba_info.csv` — tên tắt
 * lấy từ chính mã trạm đang dùng ngoài thực tế (`03.VMP.1500kVA` → `VMP`), là
 * quy ước có sẵn chứ không phải máy tự chế ra từ tên công ty. Khách chưa có
 * trạm để trống, người dùng tự khai khi cần sinh mã trạm.
 */
const NEW_CUSTOMERS = [
  { mkh: 'KCN03-016', name: 'CÔNG TY TNHH CÔNG NGHỆ THỂ THAO ARCANA POWER (VIỆT NAM)' },
  { mkh: 'KCN03-019', name: 'CÔNG TY CỔ PHẦN ĐẦU TƯ FI VINA', short: 'FI-VINA' },
  { mkh: 'KCN03-020', name: 'CÔNG TY CỔ PHẦN NHỰA VIỆT LONG HƯNG YÊN' },
  { mkh: 'KCN03-021', name: 'CHI NHÁNH CÔNG TY TNHH XNK PHÁT TRIỂN ĐÔNG DƯƠNG – NHÀ XƯỞNG TẠI HƯNG YÊN' },
  { mkh: 'KCN03-022', name: 'CÔNG TY CỔ PHẦN NHỰA VMP', short: 'VMP' },
  { mkh: 'KCN03-023', name: 'CÔNG TY CỔ PHẦN NHÔM VIỆT PHÁP HÀ NỘI', short: 'NHOMVP' },
  { mkh: 'KCN03-025', name: 'CÔNG TY CỔ PHẦN PHÁT TRIỂN TRẠM SẠC TOÀN CẦU V-GREEN' },
  { mkh: 'KCN03-026', name: 'CÔNG TY CỔ PHẦN BRS BROTHERS VIỆT NAM', short: 'BROTHERS' },
  { mkh: 'KCN03-027', name: 'CÔNG TY TNHH VERSIGENT VIỆT NAM' },
  { mkh: 'KCNTTI-011', name: 'CÔNG TY TNHH RVMC VIỆT NAM' },
  { mkh: 'KCNTH-019', name: 'CÔNG TY CỔ PHẦN PHÁT TRIỂN HẠ TẦNG VIỄN THÔNG THÀNH AN' },
  { mkh: 'KCNYM-034', name: 'CÔNG TY TNHH ANGSTROM GLOBAL (VIỆT NAM)' },
  { mkh: 'KCNYM-036', name: 'CÔNG TY TNHH BAO BÌ SUNRISE HƯNG YÊN' },
];

async function main() {
  if (!EMAIL || !PASSWORD) { console.error('Thiếu PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD'); process.exit(1); }

  const auth = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: EMAIL, password: PASSWORD }),
  });
  if (!auth.ok) { console.error('Đăng nhập PB thất bại:', auth.status); process.exit(1); }
  const { token } = await auth.json();
  const api = async (method, path, body) => {
    const r = await fetch(`${PB_URL}${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) { console.error(`HTTP ${r.status} ${method} ${path}\n${text.slice(0, 300)}`); process.exit(1); }
    return text ? JSON.parse(text) : {};
  };

  const zones = (await api('GET', '/api/collections/dm_zone/records?perPage=500')).items;
  const customers = (await api('GET', '/api/collections/dm_customer/records?perPage=500')).items;
  const zoneByCode = new Map(zones.map(z => [z.code, z]));
  const existing = new Set(customers.map(c => c.mkh));

  console.log(`PB ${PB_URL}`);
  console.log(`dm_customer đang có ${customers.length} bản ghi\n`);

  const todo = [], skip = [], noZone = [];
  for (const c of NEW_CUSTOMERS) {
    if (existing.has(c.mkh)) { skip.push(c.mkh); continue; }
    const zone = zoneByCode.get(c.mkh.split('-')[0]);
    if (!zone) { noZone.push(c.mkh); continue; }
    todo.push({ ...c, zoneId: zone.id, zoneCode: zone.code });
  }

  console.log(`── SẼ TẠO ${todo.length} KHÁCH HÀNG`);
  for (const c of todo) {
    console.log(`   + ${c.mkh.padEnd(12)} [${c.zoneCode.padEnd(7)}] tắt=${(c.short ?? '—').padEnd(10)} ${c.name.slice(0, 56)}`);
  }
  if (skip.length) console.log(`\n── ĐÃ CÓ, BỎ QUA (${skip.length}): ${skip.join(', ')}`);
  if (noZone.length) console.log(`\n── KHÔNG CÓ KCN TƯƠNG ỨNG (${noZone.length}): ${noZone.join(', ')}`);

  const chuaTat = todo.filter(c => !c.short).length;
  if (chuaTat) console.log(`\n${chuaTat} khách chưa có tên tắt — chưa sinh được mã trạm cho tới khi khai.`);

  if (!APPLY) { console.log('\n[DRY-RUN] Không ghi gì. Thêm --apply để ghi thật.'); return; }
  if (!todo.length) { console.log('\nKhông có gì để tạo.'); return; }

  console.log('');
  for (const c of todo) {
    await api('POST', '/api/collections/dm_customer/records', {
      mkh: c.mkh, name: c.name, short_name: c.short ?? '', zone: c.zoneId, active: true,
    });
    console.log(`  ✓ ${c.mkh}`);
  }
  const after = (await api('GET', '/api/collections/dm_customer/records?perPage=1')).totalItems;
  console.log(`\ndm_customer: ${customers.length} → ${after} bản ghi.`);
}

main().catch(e => { console.error(e); process.exit(1); });
