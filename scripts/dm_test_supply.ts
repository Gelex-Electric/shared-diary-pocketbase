/**
 * Bộ kiểm thử luồng cấp vật tư — chạy: npx tsx scripts/dm_test_supply.ts
 *
 * Chỉ import `src/lib/dm/supply.ts` (module thuần, không đụng PocketBase).
 */

import {
  allocCandidates, borrowCandidates, borrowsToSettle, cleanNeed, defaultNeed, matchDevice,
  openBorrowsByPoint, pointSupply, specKey, suggestTiRatio, supplyOfPoint,
} from '../src/lib/dm/supply';
import { planAttach } from '../src/lib/dm/attach';
import type { Asset, AssetType, Borrow, Device, NeedLine, Point, Purchase, PurchaseLine } from '../src/lib/dm/types';

let pass = 0;
const fails: string[] = [];

function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n     mong đợi: ${b}\n     nhận được: ${a}`);
}

let seq = 0;
const dev = (type: AssetType, ratio?: [number, number], extra: Partial<Device> = {}): Device =>
  ({ id: `d${++seq}`, serial: `SN${seq}`, type,
     ratio_primary: ratio?.[0], ratio_secondary: ratio?.[1], ...extra }) as Device;
const asset = (d: Device, point: string, on = '', off = ''): Asset =>
  ({ id: `a${++seq}`, serial: d.serial, type: d.type, device: d.id, point, date_on: on, date_off: off }) as Asset;
const point = (need: NeedLine[] | undefined, extra: Partial<Point> = {}): Point =>
  ({ id: 'P', station: 'S', role: 'chinh', connection: 'gian_tiep', need, ...extra }) as Point;
const ti = (shape: '' | 'tron' | 'vuong', r: [number, number] = [1000, 5]) => dev('TI', r, { shape });

/* --------------------------------------------------------------- specKey */

eq(specKey({ type: 'TI', ratio_primary: 1000, ratio_secondary: 5, shape: 'vuong' }), 'TI|1000/5|vuong', 'specKey: TI đủ');
eq(specKey({ type: 'CONGTO', ratio_primary: 1000, ratio_secondary: 5, shape: 'vuong' }), 'CONGTO||', 'specKey: công tơ bỏ tỷ số/hình dạng');
eq(specKey({ type: 'TU', ratio_primary: 22000, ratio_secondary: 110, shape: 'tron' }), 'TU|22000/110|', 'specKey: TU bỏ hình dạng');

/* ------------------------------------------------------------ matchDevice */

const needVuong: NeedLine = { type: 'TI', ratio_primary: 1000, ratio_secondary: 5, shape: 'vuong', qty: 3 };
eq(matchDevice(ti('vuong'), needVuong), 'yes', 'match: đúng hình dạng + tỷ số');
eq(matchDevice(ti('tron'), needVuong), 'no', 'match: sai hình dạng');
eq(matchDevice(ti(''), needVuong), 'unsure_shape', 'match: TI chưa rõ hình dạng vẫn khớp tạm');
eq(matchDevice(ti('vuong', [800, 5]), needVuong), 'no', 'match: sai tỷ số');
eq(matchDevice(ti('tron', [800, 5]), { type: 'TI' }), 'yes', 'match: nhu cầu không ghi tỷ số/hình dạng');
eq(matchDevice(dev('CONGTO'), needVuong), 'no', 'match: sai loại');

/* ------------------------------------------------- defaultNeed / tỷ số */

eq(suggestTiRatio(200), { ratio_primary: 1000, ratio_secondary: 5 }, 'suggestTiRatio: 200 ⇒ 1000/5');
eq(suggestTiRatio(1), null, 'suggestTiRatio: HSN 1 không gợi ý');
eq(suggestTiRatio(undefined), null, 'suggestTiRatio: chưa có HSN');
eq(defaultNeed('truc_tiep').map(n => `${n.type}×${n.qty}`), ['CONGTO×1', 'GP03×1', 'SIM×1'], 'defaultNeed: trực tiếp');
eq(defaultNeed('gian_tiep', 300).map(n => specKey(n) + '×' + n.qty),
   ['TI|1500/5|×3', 'CONGTO||×1', 'GP03||×1', 'SIM||×1'], 'defaultNeed: gián tiếp hạ áp, tỷ số từ HSN');
eq(defaultNeed('gian_tiep', 8800, true)[0].ratio_primary, undefined, 'defaultNeed: trung áp không đoán tỷ số TI');

/* --------------------------------------------------------------- cleanNeed */

eq(cleanNeed([{ type: 'TI', qty: 0 }, { type: 'SIM', qty: 2, ratio_primary: 5, shape: 'tron' }, { type: 'TI', qty: 3.7, shape: 'tron' }]),
   [{ type: 'SIM', qty: 2 }, { type: 'TI', qty: 3, shape: 'tron' }], 'cleanNeed: bỏ dòng 0, bỏ trường thừa, làm tròn xuống');
eq(cleanNeed(null), [], 'cleanNeed: null');

/* ---------------------------------------------------------- supplyOfPoint */

{
  // Dòng cụ thể (TI vuông 1000/5) được chọn trước dòng "TI bất kỳ".
  const v = ti('vuong'); const t = ti('tron', [800, 5]);
  const r = supplyOfPoint(
    [{ type: 'TI', qty: 1 }, { type: 'TI', ratio_primary: 1000, ratio_secondary: 5, shape: 'vuong', qty: 1 }],
    [asset(v, 'P'), asset(t, 'P')], [v, t]);
  eq(r.map(l => l.have.map(a => a.serial)), [[t.serial], [v.serial]], 'supplyOfPoint: dòng cụ thể không bị giành');
  eq(r.map(l => l.missing), [0, 0], 'supplyOfPoint: đủ cả hai');
}
{
  // TI rõ hình dạng được lấy trước TI chưa rõ.
  const u = ti(''); const v = ti('vuong');
  const r = supplyOfPoint([{ ...needVuong, qty: 1 }], [asset(u, 'P'), asset(v, 'P')], [u, v]);
  eq([r[0].have[0].serial, r[0].unsureShape], [v.serial, 0], 'supplyOfPoint: ưu tiên TI rõ hình dạng');
}

/* ----------------------------------------------------------- pointSupply */

const empty = { purchases: [] as Purchase[], purchaseLines: [] as PurchaseLine[] };
{
  eq(pointSupply(point(undefined), { assets: [], devices: [], ...empty }).state, 'chua_khai', 'pointSupply: chưa khai');
  eq(pointSupply(point([]), { assets: [], devices: [], ...empty }).state, 'chua_khai', 'pointSupply: mảng rỗng = chưa khai');
}
{
  const t1 = ti('vuong'), t2 = ti('vuong'), t3 = ti(''), m = dev('CONGTO');
  const devices = [t1, t2, t3, m];
  const need: NeedLine[] = [needVuong, { type: 'CONGTO', qty: 1 }];
  const assets = [asset(t1, 'P'), asset(t2, 'P'), asset(t3, 'P'), asset(m, 'P')];
  const r = pointSupply(point(need), { assets, devices, ...empty });
  eq([r.state, r.missing, r.unsureShape], ['du_cho_treo', 0, 1], 'pointSupply: đủ (1 TI chưa rõ hình dạng)');

  const hung = [...assets.slice(0, 3), asset(m, 'P', '2026-10-20')];
  eq(pointSupply(point(need), { assets: hung, devices, ...empty }).state, 'da_treo', 'pointSupply: công tơ có ngày treo ⇒ đã treo');

  const removed = [...assets.slice(0, 3), asset(m, 'P', '', '2026-10-21')];
  eq(pointSupply(point(need), { assets: removed, devices, ...empty }).missing, 1, 'pointSupply: dòng đã tháo không tính');
}
{
  // Thiếu 3 TI; đơn mua cho điểm đo này có 3 TI chờ về ⇒ chờ hàng. Về 1 cái (chưa phân bổ) vẫn chờ 2 ⇒ không phủ.
  const m = dev('CONGTO');
  const need: NeedLine[] = [needVuong, { type: 'CONGTO', qty: 1 }];
  const purchases = [{ id: 'PO1', code: 'PO1' }] as Purchase[];
  const purchaseLines = [{ id: 'L1', purchase: 'PO1', type: 'TI', ratio_primary: 1000, ratio_secondary: 5, shape: 'vuong', qty: 3, for_point: 'P' }] as PurchaseLine[];
  const ctx = { assets: [asset(m, 'P')], devices: [m], purchases, purchaseLines };
  eq(pointSupply(point(need), ctx).state, 'cho_hang', 'pointSupply: đơn mua phủ đủ ⇒ chờ hàng');

  const arrived = ti('vuong', [1000, 5]); arrived.purchase_line = 'L1';
  eq(pointSupply(point(need), { ...ctx, devices: [m, arrived] }).state, 'thieu', 'pointSupply: về 1, còn chờ 2 < thiếu 3 ⇒ thiếu');

  eq(pointSupply(point(need), { ...ctx, purchases: [{ id: 'PO1', code: 'PO1', cancelled: true }] as Purchase[] }).state,
     'thieu', 'pointSupply: đơn hủy không phủ');
  eq(pointSupply(point(need), { ...ctx, purchaseLines: [{ ...purchaseLines[0], for_point: 'X' }] }).state,
     'thieu', 'pointSupply: đơn cho điểm đo khác không phủ');
}

/* ------------------------------------------------------ allocCandidates */

{
  const free = ti('vuong'), unsure = ti(''), wrong = ti('tron'), hung = ti('vuong'), planned = ti('vuong');
  const heldElse = ti('vuong', [1000, 5]); heldElse.hold_point = 'Q';
  const heldMe = ti('vuong', [1000, 5]); heldMe.hold_point = 'P';
  const dead = ti('vuong'); dead.liquidated_at = '2026-01-01';
  const assets = [asset(hung, 'Q', '2026-10-01'), asset(planned, 'Q')];
  const c = allocCandidates('P', needVuong, {
    assets, devices: [unsure, free, wrong, hung, planned, heldElse, heldMe, dead] });
  eq(c.map(x => [x.device.serial, x.match]),
     [[free.serial, 'yes'], [heldMe.serial, 'yes'], [unsure.serial, 'unsure_shape']],
     'allocCandidates: chỉ hàng rảnh, giữ chỗ cho chính nó được, khớp chắc trước');
}

/* ------------------------------------------------------ borrowCandidates */

{
  const a1 = ti('vuong'), a2 = ti('vuong'), b1 = ti('vuong'), u1 = ti('vuong'), h1 = ti('vuong'), m1 = dev('CONGTO');
  const points = [
    point([{ ...needVuong, qty: 1 }], { id: 'P', code: 'P', urgent: true }),
    point([{ ...needVuong, qty: 1 }], { id: 'A', code: 'A' }),                        // đủ, chờ treo
    point([{ ...needVuong, qty: 3 }], { id: 'B', code: 'B' }),                        // còn thiếu
    point([{ ...needVuong, qty: 1 }], { id: 'U', code: 'U', urgent: true }),          // cũng gấp
    point([{ ...needVuong, qty: 1 }, { type: 'CONGTO', qty: 1 }], { id: 'H', code: 'H' }), // đã treo
  ];
  const assets = [asset(a1, 'A'), asset(a2, 'A', '2026-10-01'), asset(b1, 'B'), asset(u1, 'U'),
    asset(h1, 'H'), asset(m1, 'H', '2026-10-01')];
  const ctx = { assets, devices: [a1, a2, b1, u1, h1, m1], ...empty };
  const c = borrowCandidates('P', needVuong, points, ctx);
  eq(c.map(x => [x.device.serial, x.from.code, x.fromReady]), [[b1.serial, 'B', false], [a1.serial, 'A', true]],
     'borrowCandidates: bỏ điểm gấp, điểm đã treo, vật tư đã treo; điểm còn thiếu xếp trước');

  // planAttach coi thiết bị dự kiến ở điểm đo khác là CHUYỂN (= mượn).
  const plan = planAttach([b1], 'P', { assets, points: points.map(p => ({ ...p, hsn: 200 })) });
  eq([plan.blocks, plan.moves.map(m => [m.serial, m.fromPoint])], [[], [[b1.serial, 'B']]],
     'planAttach: dự kiến ở điểm khác ⇒ chuyển, không chặn');
  eq(planAttach([a2], 'P', { assets, points }).blocks.some(b => b.includes('đang treo ở A')), true, 'planAttach: đang treo ⇒ chặn');
  eq(planAttach([ti('vuong', [800, 5])], 'P', { assets, points: points.map(p => ({ ...p, hsn: 200 })) }).blocks.length, 1,
     'planAttach: TI lệch HSN ⇒ chặn');

  // Sổ mượn: B bị mượn 1 cái. Chưa đủ ⇒ chưa đóng; bù đủ 3 ⇒ đóng.
  const borrows = [{ id: 'X', device: b1.id, from_point: 'B', to_point: 'P' }] as Borrow[];
  eq(borrowsToSettle(borrows, points, ctx).length, 0, 'borrowsToSettle: còn thiếu ⇒ chưa đóng');
  const fill = [ti('vuong'), ti('vuong'), ti('vuong')];
  const ctx2 = { ...ctx, assets: [...assets, ...fill.map(d => asset(d, 'B'))], devices: [...ctx.devices, ...fill] };
  eq(borrowsToSettle(borrows, points, ctx2).map(b => b.id), ['X'], 'borrowsToSettle: bù đủ ⇒ đóng');
  eq(borrowsToSettle([{ ...borrows[0], settled_at: '2026-10-26' }], points, ctx2).length, 0, 'borrowsToSettle: đã đóng bỏ qua');
  eq([...openBorrowsByPoint([...borrows, { ...borrows[0], id: 'Y' }, { ...borrows[0], id: 'Z', settled_at: '2026-10-01' }])],
     [['B', 2]], 'openBorrowsByPoint: đếm dòng chưa đóng');
}

/* ---------------------------------------------------------------- kết quả */

if (fails.length) {
  console.error(`✗ ${fails.length} ca đỏ / ${pass + fails.length}`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} ca xanh`);
