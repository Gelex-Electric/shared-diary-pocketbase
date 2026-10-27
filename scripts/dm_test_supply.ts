/**
 * Bộ kiểm thử luồng cấp vật tư — chạy: npx tsx scripts/dm_test_supply.ts
 *
 * Chỉ import `src/lib/dm/supply.ts` (module thuần, không đụng PocketBase).
 */

import {
  allocCandidates, borrowCandidates, reconcile, borrowsToSettle, cleanNeed, defaultNeed, matchDevice,
  nextPurchaseCode, openBorrowsByPoint, pointSupply, purchaseNeeds, purchaseState, specKey,
  suggestTiRatio, supplyOfPoint, supplyTasks, taskCount,
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

/* ------------------------------------------------------ loại công tơ */

const needCtTT: NeedLine = { type: 'CONGTO', meter_kind: 'truc_tiep', qty: 1 };
eq(specKey(needCtTT), 'CONGTO||truc_tiep', 'specKey: công tơ mang loại');
eq(matchDevice(dev('CONGTO', undefined, { meter_kind: 'truc_tiep' }), needCtTT), 'yes', 'match: công tơ đúng loại');
eq(matchDevice(dev('CONGTO', undefined, { meter_kind: 'gian_tiep' }), needCtTT), 'no', 'match: công tơ gián tiếp không thay được trực tiếp');
eq(matchDevice(dev('CONGTO'), needCtTT), 'unsure_shape', 'match: công tơ chưa rõ loại khớp tạm');
eq(matchDevice(dev('CONGTO', undefined, { meter_kind: 'gian_tiep' }), { type: 'CONGTO' }), 'yes', 'match: nhu cầu không ghi loại');
eq(defaultNeed('truc_tiep')[0], { type: 'CONGTO', meter_kind: 'truc_tiep', qty: 1 }, 'defaultNeed: trực tiếp ⇒ công tơ trực tiếp');
eq(cleanNeed([{ type: 'CONGTO', meter_kind: 'gian_tiep', shape: 'tron', qty: 1 }, { type: 'SIM', meter_kind: 'truc_tiep', qty: 1 }]),
   [{ type: 'CONGTO', qty: 1, meter_kind: 'gian_tiep' }, { type: 'SIM', qty: 1 }], 'cleanNeed: loại công tơ chỉ giữ ở CONGTO');

/* ------------------------------------------------- defaultNeed / tỷ số */

eq(suggestTiRatio(200), { ratio_primary: 1000, ratio_secondary: 5 }, 'suggestTiRatio: 200 ⇒ 1000/5');
eq(suggestTiRatio(1), null, 'suggestTiRatio: HSN 1 không gợi ý');
eq(suggestTiRatio(undefined), null, 'suggestTiRatio: chưa có HSN');
eq(defaultNeed('truc_tiep').map(n => `${n.type}×${n.qty}`), ['CONGTO×1', 'GP03×1', 'SIM×1'], 'defaultNeed: trực tiếp');
eq(defaultNeed('gian_tiep', 300).map(n => specKey(n) + '×' + n.qty),
   ['TI|1500/5|tron×3', 'CONGTO||gian_tiep×1', 'GP03||×1', 'SIM||×1'], 'defaultNeed: gián tiếp hạ áp, tỷ số từ HSN, TI mặc định tròn');
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
  eq([r.state, r.missing, r.unsureShape], ['cho_treo', 0, 1], 'pointSupply: đủ quy cách, chưa treo ⇒ chờ treo (1 TI chưa rõ hình dạng)');

  const hungMeter = [...assets.slice(0, 3), asset(m, 'P', '2026-10-20')];
  eq(pointSupply(point(need), { assets: hungMeter, devices, ...empty }).state, 'cho_treo',
     'pointSupply: mới treo công tơ, TI còn chờ ⇒ vẫn chờ treo (điểm đo đã treo vẫn trong luồng)');
  const allHung = [asset(t1, 'P', '2026-10-20'), asset(t2, 'P', '2026-10-20'), asset(t3, 'P', '2026-10-20'), asset(m, 'P', '2026-10-20')];
  eq(pointSupply(point(need), { assets: allHung, devices, ...empty }).state, 'du', 'pointSupply: treo đủ ⇒ đã treo đủ');
  const oldPoint = [asset(m, 'P', '2024-01-01')];
  eq(pointSupply(point(undefined), { assets: oldPoint, devices, ...empty }).state, 'ngoai_luong', 'pointSupply: điểm đo cũ không nhu cầu ⇒ ngoài luồng');
  eq(pointSupply(point(need), { assets: [asset(m, 'P', '2026-10-20')], devices, ...empty }).state, 'thieu',
     'pointSupply: đã treo nhưng thiếu TI ⇒ thiếu (cần treo bổ sung)');

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
    point([{ ...needVuong, qty: 1 }], { id: 'P', code: 'P' }),
    point([{ ...needVuong, qty: 1 }], { id: 'A', code: 'A' }),                        // đã treo đủ (a2), a1 thừa
    point([{ ...needVuong, qty: 3 }], { id: 'B', code: 'B' }),                        // còn thiếu
    point([{ ...needVuong, qty: 1 }], { id: 'U', code: 'U' }),                        // đủ, chờ treo
    point([{ ...needVuong, qty: 1 }, { type: 'CONGTO', qty: 1 }], { id: 'H', code: 'H' }), // công tơ treo, TI chờ treo
  ];
  const assets = [asset(a1, 'A'), asset(a2, 'A', '2026-10-01'), asset(b1, 'B'), asset(u1, 'U'),
    asset(h1, 'H'), asset(m1, 'H', '2026-10-01')];
  const ctx = { assets, devices: [a1, a2, b1, u1, h1, m1], ...empty };
  const c = borrowCandidates('P', needVuong, points, ctx);
  eq(c.map(x => [x.device.serial, x.from.code, x.fromReady]),
     [[a1.serial, 'A', false], [b1.serial, 'B', false], [h1.serial, 'H', true], [u1.serial, 'U', true]],
     'borrowCandidates: mọi điểm đo (bỏ "gấp"), chỉ dòng chưa treo; điểm chưa chờ treo xếp trước');

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

/* ------------------------------------------------------- purchaseNeeds */

{
  // P thiếu 3 TI vuông 1000/5; Q thiếu 2 TI bất kỳ. Đơn chờ về 2 TI vuông 1000/5; kho rảnh 1 TI vuông 1000/5 + 1 TI tròn 800/5.
  const pts = [
    point([needVuong], { id: 'P', code: 'P' }),
    point([{ type: 'TI', qty: 2 }], { id: 'Q', code: 'Q' }),
    point([{ type: 'SIM', qty: 1 }], { id: 'R', code: 'R' }),
  ];
  const sim = dev('SIM');
  const spareV = ti('vuong'), spareT = ti('tron', [800, 5]);
  const held = ti('vuong'); held.hold_point = 'Z';
  const ctx = {
    assets: [asset(sim, 'R')], devices: [sim, spareV, spareT, held],
    purchases: [{ id: 'PO', code: 'PO' }] as Purchase[],
    purchaseLines: [{ id: 'L', purchase: 'PO', type: 'TI', ratio_primary: 1000, ratio_secondary: 5, shape: 'vuong', qty: 2 }] as PurchaseLine[],
  };
  const r = purchaseNeeds(pts, ctx, new Set(['Q']));
  eq(r.map(x => [x.key, x.missing, x.onOrder, x.inStock, x.toBuy]),
     [['TI||', 2, 0, 1, 1], ['TI|1000/5|vuong', 3, 2, 1, 0]],
     'purchaseNeeds: quy cách cụ thể trừ trước, mỗi đơn/thiết bị trừ một lần; điểm đủ không vào');
  eq(r[0].points.map(x => [x.point.code, x.missing, x.borrowed]), [['Q', 2, true]], 'purchaseNeeds: kèm điểm đo + cờ bị mượn');
}

/* ------------------------------------------------- purchaseState / mã đơn */

{
  const po = { id: 'PO', code: 'DM-2026-007' } as Purchase;
  const lines = [{ id: 'L1', purchase: 'PO', type: 'TI', qty: 3 }, { id: 'L2', purchase: 'PO', type: 'SIM', qty: 1 }] as PurchaseLine[];
  const got = (n: number, line: string) => Array.from({ length: n }, () => dev('TI', undefined, { purchase_line: line }));
  eq(purchaseState(po, lines, []).state, 'da_dat', 'purchaseState: chưa về');
  eq(purchaseState(po, lines, got(3, 'L1')), { state: 've_mot_phan', ordered: 4, received: 3 }, 'purchaseState: về một phần');
  eq(purchaseState(po, lines, [...got(3, 'L1'), ...got(1, 'L2')]).state, 'du', 'purchaseState: đủ');
  eq(purchaseState({ ...po, cancelled: true }, lines, []).state, 'huy', 'purchaseState: hủy');
  eq(nextPurchaseCode([po, { id: 'x', code: 'DM-2025-099' } as Purchase], 2026), 'DM-2026-008', 'nextPurchaseCode: theo năm');
  eq(nextPurchaseCode([], 2027), 'DM-2027-001', 'nextPurchaseCode: năm mới');
}

/* ---------------------------------------------------------- supplyTasks */

{
  const m1 = dev('CONGTO'), m2 = dev('CONGTO'), m3 = dev('CONGTO');
  const pts = [
    point(undefined, { id: 'A', code: 'A' }),                                       // ① chưa khai
    point([{ type: 'CONGTO', qty: 1 }], { id: 'B', code: 'B' }),                    // ② thiếu
    point([{ type: 'CONGTO', qty: 1 }], { id: 'C', code: 'C' }),                    // ④ đủ chờ treo
    point(undefined, { id: 'D', code: 'D' }),                                       // từng treo rồi tháo ⇒ thoát luồng
    point([{ type: 'CONGTO', qty: 1 }], { id: 'E', code: 'E' }),                    // đang treo
  ];
  const assets = [asset(m1, 'C'), asset(m2, 'D', '2025-01-01', '2026-01-01'), asset(m3, 'E', '2026-10-01')];
  const late = { id: 'PO', code: 'PO', expected_at: '2026-10-01' } as Purchase;
  const ctx = {
    assets, devices: [m1, m2, m3, ti(''), ti('vuong')],
    purchases: [late, { id: 'PO2', code: 'PO2', expected_at: '2026-12-01' } as Purchase],
    purchaseLines: [{ id: 'L', purchase: 'PO', type: 'SIM', qty: 1 }, { id: 'L2', purchase: 'PO2', type: 'SIM', qty: 1 }] as PurchaseLine[],
  };
  const t = supplyTasks(pts, ctx, '2026-10-26');
  eq([t.chuaKhai, t.thieu, t.choTreo].map(l => l.map(p => p.code)), [['A'], ['B'], ['C']],
     'supplyTasks: chia đúng nhóm; điểm đo từng treo rồi tháo không vào "chưa khai"');
  eq([t.lateOrders.map(o => o.code), t.tiNoShape], [['PO'], 1], 'supplyTasks: đơn trễ + TI chưa rõ hình dạng');
  eq([taskCount(t, 'kinh_doanh'), taskCount(t, 'vat_tu'), taskCount(t, 'van_hanh')], [1, 3, 1],
     'taskCount: KD/VH = chờ treo; VT = chưa khai + thiếu + đơn trễ');
  eq(supplyTasks(pts, ctx, '2026-10-26', p => p.id !== 'C').choTreo.length, 0, 'supplyTasks: lọc theo KCN của người xem');
}

/* ------------------------------------------------------------ reconcile */

{
  const tA = ti('tron'), tB = ti('tron'), tC = ti('tron'), tX = ti('tron'), tY = ti('tron'), tZ = ti('tron');
  const sim = dev('SIM'), m = dev('CONGTO');
  const devices = [tA, tB, tC, tX, tY, tZ, sim, m];
  const need3: NeedLine[] = [{ type: 'TI', ratio_primary: 1000, ratio_secondary: 5, shape: 'tron', qty: 3 }, { type: 'CONGTO', qty: 1 }];
  const pt = point(need3);
  const ids = (l: { id: string }[]) => l.map(a => a.id);

  // Nhu cầu gắn A,B,C; hiện trường treo X,Y,Z cùng quy cách ⇒ A,B,C thừa ⇒ gỡ; không thiếu.
  const plan = [asset(tA, 'P'), asset(tB, 'P'), asset(tC, 'P'), asset(m, 'P')];
  const field = [asset(tX, 'P', '2026-10-27'), asset(tY, 'P', '2026-10-27'), asset(tZ, 'P', '2026-10-27'), asset(m, 'P', '2026-10-27')];
  const r1 = reconcile(pt, [...plan.slice(0, 3), ...field], devices);
  eq([ids(r1.release), r1.shortages.length, r1.extraHung.length], [ids(plan.slice(0, 3)), 0, 0],
     'reconcile: treo khác số No cùng quy cách ⇒ gỡ nhu cầu thừa, không thiếu');

  // Treo đúng 2/3 TI nhu cầu + 0 cái khác ⇒ dòng còn lại vẫn chờ treo, không gỡ gì, không thiếu.
  const partial = [asset(tA, 'P', '2026-10-27'), asset(tB, 'P', '2026-10-27'), asset(tC, 'P'), asset(m, 'P', '2026-10-27')];
  const r2 = reconcile(pt, partial, devices);
  eq([r2.release.length, r2.shortages.length], [0, 0], 'reconcile: treo đúng nhu cầu một phần ⇒ không gỡ, không thiếu');

  // Chỉ treo 2 TI khác (X,Y), nhu cầu còn A ⇒ A vẫn đủ bù 1 ⇒ không thiếu; B,C thừa ⇒ gỡ.
  const r3 = reconcile(pt, [asset(tA, 'P'), asset(tB, 'P'), asset(tC, 'P'), asset(tX, 'P', '2026-10-27'), asset(tY, 'P', '2026-10-27'), asset(m, 'P', '2026-10-27')], devices);
  eq([r3.release.length, r3.shortages.length], [2, 0], 'reconcile: treo khác 2/3 ⇒ gỡ 2 dòng nhu cầu thừa');

  // Không có nhu cầu chưa treo, chỉ treo 2 TI ⇒ đề xuất treo bổ sung 1 TI.
  const r4 = reconcile(pt, [asset(tX, 'P', '2026-10-27'), asset(tY, 'P', '2026-10-27'), asset(m, 'P', '2026-10-27')], devices);
  eq(r4.shortages.map(l => [l.line.type, l.missing]), [['TI', 1]], 'reconcile: treo thiếu ⇒ đề xuất treo bổ sung');

  // Treo thêm SIM ngoài nhu cầu ⇒ ghi chú, không đụng. Dòng nhu cầu SIM không thuộc quy cách nào ⇒ giữ.
  const r5 = reconcile(pt, [...field, asset(sim, 'P', '2026-10-27')], devices);
  eq(r5.extraHung.map(a => a.type), ['SIM'], 'reconcile: treo ngoài nhu cầu chỉ ghi chú');
  const r6 = reconcile(pt, [...field, asset(sim, 'P')], devices);
  eq(r6.release.length, 0, 'reconcile: dòng chưa treo không khớp quy cách nào ⇒ giữ nguyên');

  // Không bao giờ gỡ dòng đã treo; điểm đo chưa khai nhu cầu ⇒ không làm gì.
  eq(r1.release.every(a => !a.date_on), true, 'reconcile: không đụng dòng đã treo');
  eq(reconcile(point(undefined), plan, devices).release.length, 0, 'reconcile: chưa khai nhu cầu ⇒ không làm gì');
}

/* ---------------------------------------------------------------- kết quả */

if (fails.length) {
  console.error(`✗ ${fails.length} ca đỏ / ${pass + fails.length}`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} ca xanh`);
