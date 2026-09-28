/**
 * Bộ kiểm thử chọn vật tư từ kho theo HSN — chạy: npx tsx scripts/dm_test_tuti.ts
 *
 * Chỉ import `src/lib/dm/tutiPick.ts` (module thuần, không đụng PocketBase).
 */

import { freeDevices, parseHsnInput, setMatchesHsn, suggestSets } from '../src/lib/dm/tutiPick';
import type { Asset, AssetType, Device } from '../src/lib/dm/types';

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
const asset = (d: Device, point: string, on: string, off = '', byDevice = true): Asset =>
  ({ id: `a${++seq}`, serial: d.serial, type: d.type, device: byDevice ? d.id : undefined,
     point, date_on: on, date_off: off }) as Asset;
const serials = (l: Device[]) => l.map(d => d.serial);

/* ---------------------------------------------------------- parseHsnInput */

eq(parseHsnInput('200'), 200, 'parseHsnInput: số nguyên');
eq(parseHsnInput(' 8800 '), 8800, 'parseHsnInput: bỏ khoảng trắng');
eq(parseHsnInput('2,5'), 2.5, 'parseHsnInput: dấu phẩy thập phân');
eq(parseHsnInput(''), null, 'parseHsnInput: rỗng KHÔNG thành 0');
eq(parseHsnInput('0'), null, 'parseHsnInput: 0 không hợp lệ');
eq(parseHsnInput('-40'), null, 'parseHsnInput: âm không hợp lệ');
eq(parseHsnInput('12abc'), null, 'parseHsnInput: có chữ là sai, không cắt thành 12');

/* ---------------------------------------------------------- setMatchesHsn */

eq(setMatchesHsn(1, null), true, 'setMatchesHsn: HSN 1, không TI ⇒ khớp (đo thẳng)');
eq(setMatchesHsn(1, { primary: 5, secondary: 5 }), false, 'setMatchesHsn: HSN 1 mà có TI ⇒ lệch');
eq(setMatchesHsn(40, { primary: 200, secondary: 5 }), true, 'setMatchesHsn: TI 200/5 = 40');
eq(setMatchesHsn(40, { primary: 200, secondary: 5 }, { primary: null, secondary: null }), true,
   'setMatchesHsn: TU rỗng coi bằng 1');
eq(setMatchesHsn(60, { primary: 200, secondary: 5 }), false, 'setMatchesHsn: TI 200/5 ≠ 60');
eq(setMatchesHsn(8800, { primary: 200, secondary: 5 }, { primary: 22000, secondary: 100 }), true,
   'setMatchesHsn: 40 × 220 = 8800');
eq(setMatchesHsn(4000, { primary: 20, secondary: 5 }, { primary: 22000, secondary: 22 }), true,
   'setMatchesHsn: TU 22000/22 = 1000');
eq(setMatchesHsn(40, null), false, 'setMatchesHsn: HSN > 1 mà không có TI ⇒ lệch');
eq(setMatchesHsn(40, { primary: 200, secondary: null }), false, 'setMatchesHsn: tỷ số TI khai thiếu');
eq(setMatchesHsn(0, null), false, 'setMatchesHsn: HSN 0 không hợp lệ');

/* ------------------------------------------------------------ freeDevices */

const ti1 = dev('TI', [200, 5]);
const ti2 = dev('TI', [200, 5]);
const ti3 = dev('TI', [200, 5]);
const tiBusy = dev('TI', [200, 5]);
const tiLiq = dev('TI', [200, 5], { liquidated_at: '2026-05-01 00:00:00.000Z' });
const tiOld = dev('TI', [200, 5]);
const tiHold = dev('TI', [200, 5], { hold_point: 'P9' });
const meter = dev('CONGTO');
const assets: Asset[] = [
  asset(tiBusy, 'P2', '2026-01-01'),               // đang treo ở P2
  asset(tiOld, 'P2', '2025-01-01', '2026-01-01'),  // đã tháo ⇒ về kho
  asset(ti3, 'P1', '2026-02-01'),                  // đang treo ở chính P1
  asset(meter, 'P2', '2026-01-01', '', false),     // nối theo serial, không có `device`
];
const all = [ti1, ti2, ti3, tiBusy, tiLiq, tiOld, tiHold, meter];

eq(serials(freeDevices(all, assets, { type: 'TI' })),
   serials([ti1, ti2, tiOld, tiHold]),
   'freeDevices: bỏ cái đang treo, cái thanh lý; giữ cái đã tháo và cái đang giữ chỗ');
eq(serials(freeDevices(all, assets, { type: 'TI', pointId: 'P1' })),
   serials([ti1, ti2, ti3, tiOld, tiHold]),
   'freeDevices: lần lắp của CHÍNH điểm đo đang sửa không tính là bận');
eq(serials(freeDevices(all, assets, { type: 'TI', exclude: [ti1.serial, ' '] })),
   serials([ti2, tiOld, tiHold]),
   'freeDevices: loại số No đã chọn ở dòng khác');
eq(serials(freeDevices(all, assets, { type: 'CONGTO' })), [],
   'freeDevices: nối lần lắp theo serial khi thiếu `device`');
eq(freeDevices([dev('TI', [200, 5], { serial: '  ' })], []).length, 0,
   'freeDevices: thiết bị không có số No thì bỏ');

/* ------------------------------------------------------------ suggestSets */

const stock = [
  dev('TI', [200, 5]), dev('TI', [200, 5]), dev('TI', [200, 5]),         // 3 × 40
  dev('TI', [1000, 5]), dev('TI', [1000, 5]),                            // 2 × 200 — thiếu
  dev('TI', [20, 5]), dev('TI', [20, 5]), dev('TI', [20, 5]), dev('TI', [20, 5]), // 4 × 4
  dev('TI', [100, 5]), dev('TI', [100, 5]), dev('TI', [100, 5]),         // 3 × 20
  dev('TU', [22000, 100]), dev('TU', [22000, 100]),                      // 2 × 220
  dev('TU', [22000, 110]),                                               // 1 × 200
  dev('TI'),                                                             // chưa khai tỷ số
];

eq(suggestSets(40, stock), [{ ti: '200/5', tiFree: 3, tuFree: 0 }],
   'suggestSets: HSN 40 ⇒ bộ 3 TI 200/5, không TU');
eq(suggestSets(200, stock), [],
   'suggestSets: HSN 200 ⇒ TI 1000/5 chỉ có 2 cái nên không đủ bộ');
eq(suggestSets(880, stock), [{ ti: '20/5', tu: '22000/100', tiFree: 4, tuFree: 2 }],
   'suggestSets: 4 × 220 = 880');
eq(suggestSets(4000, stock), [{ ti: '100/5', tu: '22000/110', tiFree: 3, tuFree: 1 }],
   'suggestSets: 20 × 200 = 4000 (tỷ số chia lẻ vẫn khớp)');
eq(suggestSets(1, stock), [], 'suggestSets: HSN 1 ⇒ đo thẳng, không gợi ý TI');
eq(suggestSets(NaN, stock), [], 'suggestSets: HSN hỏng ⇒ rỗng');

const mixed = [
  ...[1, 2, 3].map(() => dev('TI', [800, 5])),                 // 160 — chỉ TI
  ...[1, 2, 3, 4, 5].map(() => dev('TI', [40, 5])),            // 8 × TU 20 = 160
  dev('TU', [400, 20]),
];
eq(suggestSets(160, mixed).map(s => `${s.ti}|${s.tu ?? ''}`), ['800/5|', '40/5|400/20'],
   'suggestSets: bộ chỉ TI xếp trước bộ có TU');

/* ---------------------------------------------------------------- kết quả */

if (fails.length) {
  console.error(`✗ ${fails.length} ca đỏ / ${pass + fails.length}`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ ${pass} ca xanh`);
