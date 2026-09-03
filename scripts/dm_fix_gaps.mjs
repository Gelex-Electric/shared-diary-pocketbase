#!/usr/bin/env node
/**
 * Vá 2 chỗ lệch còn lại giữa sổ Excel và PocketBase (user chốt 28/08/2026):
 *
 *   1. YM.VNC.T1.5500kVA — thiếu GP-03 `869914061460517`. Sổ ghi treo cùng
 *      ngày với công tơ và bộ TI/TU đầu tiên: 29/02/2024.
 *
 *   2. TH.SAUSUM.500kVA — điểm đo chưa từng khai trên PB. Khai lại đầy đủ theo
 *      sổ (treo 14/09/2024) rồi THANH LÝ: công tơ `2410320615` của nó nay đang
 *      chạy ở `TH.FANTASY.T1.3150kVA` từ 14/04/2025, nên đó là ngày tháo.
 *
 * KHÔNG đụng tới 03.AQ và YM.TITAN.NX3.EVERJOY — xem phần in ra cuối, cả hai
 * đều là LỖI GÕ CỦA EXCEL chứ PB không thiếu gì.
 *
 * Mặc định CHẠY THỬ. Thêm `--apply` mới ghi:
 *   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... node scripts/dm_fix_gaps.mjs
 */
const APPLY = process.argv.includes('--apply');
const PB = (process.env.PB_URL || 'https://getc.up.railway.app/pb').replace(/\/$/, '');

const auth = await (await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD }),
})).json();
if (!auth.token) { console.error('Đăng nhập PocketBase thất bại'); process.exit(1); }
const H = { Authorization: auth.token };

/** Lấy HẾT bản ghi — `dm_asset` đã vượt 500, một trang là thiếu im lặng. */
const allOf = async (col) => {
  const o = [];
  for (let p = 1; ; p++) {
    const r = await (await fetch(
      `${PB}/api/collections/${col}/records?perPage=500&page=${p}`, { headers: H })).json();
    o.push(...(r.items ?? []));
    if (p >= (r.totalPages ?? 1)) return o;
  }
};
const [zones, customers, stations, points, assets] = await Promise.all(
  ['dm_zone', 'dm_customer', 'dm_station', 'dm_point', 'dm_asset'].map(allOf));

const post = async (col, body) => {
  const r = await fetch(`${PB}/api/collections/${col}/records`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${col}: ${JSON.stringify(j)}`);
  return j;
};

const todo = [];

/* ---------------------- 1. GP-03 còn thiếu của VNC ---------------------- */
const VNC_GP03 = '869914061460517';
const vnc = points.find(p => (p.code || '').includes('YM.VNC.T1'));
const vncHas = assets.some(a => String(a.serial).trim() === VNC_GP03);
if (!vnc) console.error('Không tìm thấy điểm đo VNC');
else if (vncHas) console.log(`GP-03 ${VNC_GP03} đã có trên PB — bỏ qua.`);
else {
  todo.push({
    what: `GP-03 ${VNC_GP03} → ${vnc.code}, treo 2024-02-29`,
    run: () => post('dm_asset', {
      serial: VNC_GP03, type: 'GP03', point: vnc.id,
      date_on: '2024-02-29', active: true, status: 'dang_treo',
    }),
  });
}

/* --------------------- 2. TH.SAUSUM.500kVA — khai rồi thanh lý --------------------- */
const SAUSUM = {
  code: 'TH.SAUSUM.500kVA',
  mkh: 'KCNTH-010A',           // CÔNG TY TNHH XÂY DỰNG TRUNG QUỐC SAUSUM (VIỆT NAM)
  ident: 'T1', sdmKva: 500,
  dateOn: '2024-09-14',
  /*
    Ngày tháo = ngày công tơ của nó bắt đầu chạy ở điểm đo khác. Công tơ
    2410320615 treo tại TH.FANTASY.T1.3150kVA từ 14/04/2025, mà một công tơ
    không thể đo hai nơi cùng lúc — đây chính là luật (4) `liveElsewhere` trong
    form của app.
  */
  dateOff: '2025-04-14',
  items: [
    { serial: '2410320615', type: 'CONGTO' },
    { serial: '2420062059', type: 'TI', primary: 500, secondary: 5 },
    { serial: '2420062050', type: 'TI', primary: 500, secondary: 5 },
    { serial: '2420062466', type: 'TI', primary: 500, secondary: 5 },
  ],
};

const sausumPoint = points.find(p => (p.code || '').toUpperCase().includes('SAUSUM'));
if (sausumPoint) console.log(`Điểm đo ${sausumPoint.code} đã có trên PB — bỏ qua.`);
else {
  /*
    Tra khách hàng theo ĐÚNG mã, KHÔNG dò tên tắt làm phương án hai.

    Bản đầu của script có nhánh dự phòng đoán theo tên, và với mã sai
    (`KCNTH-011`) nó lặng lẽ nhả ra XULI — suýt khai cả một trạm SAUSUM vào tên
    khách hàng khác. Thà dừng lại còn hơn đoán chủ trạm.
  */
  const cus = customers.find(c => c.mkh === SAUSUM.mkh);
  if (!cus) {
    console.error(`Không có khách hàng ${SAUSUM.mkh} trên PB — dừng, không đoán sang khách khác.`);
  } else if ((cus.short_name ?? '').toUpperCase() !== 'SAUSUM') {
    console.error(`${SAUSUM.mkh} trên PB là "${cus.short_name}" chứ không phải SAUSUM — dừng.`);
  } else {
    const zone = zones.find(z => z.id === cus.zone);
    const stCode = `${zone.code.replace(/^KCN/, '')}.${cus.short_name}.${SAUSUM.ident}.${SAUSUM.sdmKva}kVA`;
    const stExist = stations.find(s => s.code === stCode);
    todo.push({
      what: `Trạm + điểm đo ${stCode} (KH ${cus.mkh}), treo ${SAUSUM.dateOn} → tháo ${SAUSUM.dateOff}, `
        + `${SAUSUM.items.length} vật tư, HSN 100, trạng thái ĐÃ THÁO GỠ`,
      run: async () => {
        const st = stExist ?? await post('dm_station', {
          code: stCode, zone: zone.id, customer: cus.id, ident: SAUSUM.ident, sdm_kva: SAUSUM.sdmKva,
          note: 'Excel: TH.SAUSUM.500kVA — đã thanh lý, công tơ chuyển sang TH.FANTASY.T1.3150kVA',
        });
        const pt = await post('dm_point', {
          code: stCode, line_name: stCode, station: st.id, zone: zone.id, customer: cus.id,
          ident: '', sub_label: '', role: 'chinh', connection: 'gian_tiep', hsn: 100,
          status: 'thao_go',
          note: `Thanh lý ${SAUSUM.dateOff}: công tơ ${SAUSUM.items[0].serial} chuyển sang TH.FANTASY.T1.3150kVA.`,
        });
        for (const it of SAUSUM.items) {
          await post('dm_asset', {
            serial: it.serial, type: it.type, point: pt.id,
            date_on: SAUSUM.dateOn, date_off: SAUSUM.dateOff,
            // Đã tháo ⇒ không còn đo ở đây nữa.
            active: false, status: 'thao_go',
            ...(it.primary ? { ratio_primary: it.primary, ratio_secondary: it.secondary } : {}),
          });
        }
        return pt;
      },
    });
  }
}

/* ------------------------------- In ra ------------------------------- */
console.log('\nSẼ LÀM:');
for (const t of todo) console.log(`  • ${t.what}`);
if (!todo.length) console.log('  (không có gì)');

console.log(`
KHÔNG ĐỤNG — hai chỗ này Excel gõ sai, PB đúng:

  03.AQ.T1.2500kVA
    Excel ghi TI  2620400694, 2620400696, 2620400965
    PB   có  TI  2620400694, 2620400696, 2620400695   ← ba số LIÊN TIẾP
    "2620400965" gần như chắc chắn là gõ đảo của "2620400695". PB đã đủ 3 TI
    3000/5, HSN 600, không thiếu gì. Công suất trạm PB ghi 2500kVA — đúng như
    bạn xác nhận; chỗ sai là Excel ghi mã "03.AQ.1250KVA".

  YM.TITAN.NX3.400kVA.EVERJOY
    Excel ghi công tơ "24100121440" — ELEVEN chữ số, trong khi số công tơ luôn
    là 10 chữ số.
    PB   có  công tơ "2410121440" — 10 chữ số, treo đúng ngày 10/06/2026.
    Excel thừa một số 0 sau "2410". Cùng một công tơ, PB không thiếu.
    (Bộ TI thì hai bên ghi khác nhau: Excel 2420002498/2420002285/2420021773,
     PB 2420021703/2420021819/2420021773 — chỉ trùng 1. Cần soi tay, script
     không đoán.)
`);

if (!APPLY) { console.log('CHẠY THỬ — chưa ghi gì. Thêm --apply để ghi thật.'); process.exit(0); }
for (const t of todo) { await t.run(); console.log(`OK  ${t.what}`); }
