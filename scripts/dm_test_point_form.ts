/**
 * Bộ kiểm thử luật BẢNG VẬT TƯ của form điểm đo — chạy: npx tsx scripts/dm_test_point_form.ts
 *
 * Chỉ import `src/lib/dm/pointForm.ts` (module thuần, không đụng PocketBase).
 * Mỗi ca ứng với một luật đã được user chốt — ca đỏ nghĩa là đã lỡ đổi nghiệp vụ.
 */

import {
  addRow, applyRowRules, applySet, hsnSig, liveElsewhere, lockedOn, newRow, normalizeActive,
  type AssetRow, type RowCtx,
} from '../src/lib/dm/pointForm';
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
const dev = (type: AssetType, serial: string, ratio?: [number, number]): Device =>
  ({ id: `d${++seq}`, serial, type, ratio_primary: ratio?.[0], ratio_secondary: ratio?.[1] }) as Device;
const asset = (serial: string, type: AssetType, point: string, on: string, off = ''): Asset =>
  ({ id: `a${++seq}`, serial, type, point, date_on: on, date_off: off, active: !off }) as Asset;
const row = (p: Partial<AssetRow>): AssetRow =>
  ({ ...newRow(), ...p, active: !(p.dateOff ?? '').trim() });
/** Rút gọn kết quả để so: chỉ các trường nghiệp vụ. */
const pick = (rows: AssetRow[], f: (keyof AssetRow)[]) =>
  rows.map(r => Object.fromEntries(f.map(k => [k, r[k]])));

const STOCK: Device[] = [
  dev('TI', 'TI-A', [200, 5]), dev('TI', 'TI-B', [200, 5]), dev('TI', 'TI-C', [300, 5]),
  dev('CONGTO', 'CT-1'), dev('CONGTO', 'CT-BUSY'), dev('TI', 'TI-BUSY', [200, 5]),
];
const ctx: RowCtx = {
  devices: STOCK,
  assets: [
    asset('CT-BUSY', 'CONGTO', 'P-OTHER', '2026-05-01'),
    asset('TI-BUSY', 'TI', 'P-OTHER', '2026-06-10'),
    asset('CT-HERE', 'CONGTO', 'P-ME', '2026-01-01'),
  ],
  editingId: 'P-ME',
};

/* --------------------------------------------------- normalizeActive, hsnSig */

eq(normalizeActive([row({ dateOff: '2026-01-01' }), row({})]).map(r => r.active), [false, true],
  'normalizeActive: có ngày tháo ⇒ không hoạt động');
{
  const a = row({ type: 'TI', serial: 'X', ratio: '200/5' });
  const b = { ...a, key: 'khac', want: '200/5' };
  eq(hsnSig('200', [a]) === hsnSig(' 200 ', [b]), true, 'hsnSig: bỏ qua key, want, khoảng trắng HSN');
  eq(hsnSig('200', [a]) === hsnSig('300', [a]), false, 'hsnSig: đổi HSN ⇒ chữ ký khác');
}

/* ------------------------------------------------ liveElsewhere / lockedOn */

eq(liveElsewhere(ctx, 'CT-BUSY')?.point, 'P-OTHER', 'liveElsewhere: đang treo ở điểm khác');
eq(liveElsewhere(ctx, 'CT-HERE'), undefined, 'liveElsewhere: treo ở CHÍNH điểm đang sửa thì không tính');
eq(liveElsewhere(ctx, '  '), undefined, 'liveElsewhere: số No rỗng');
eq(lockedOn(ctx, row({ serial: 'CT-BUSY' })), true, 'lockedOn: dòng MỚI mang thiết bị treo nơi khác');
eq(lockedOn(ctx, row({ id: 'x', serial: 'CT-BUSY' })), false, 'lockedOn: dòng ĐÃ LƯU không khoá (lịch sử)');

/* ----------------------------------------- Luật 1: tỷ số dùng chung theo loại */
{
  const rows = [row({ type: 'TI', ratio: '200/5' }), row({})];
  const out = applyRowRules(ctx, rows, rows[1].key, { type: 'TI' });
  eq(out[1].ratio, '200/5', 'L1: đổi loại sang TI ⇒ thừa hưởng tỷ số của TI cùng bộ');
}
{
  const rows = [row({ type: 'TI' }), row({ type: 'TI', ratio: '300/5' }), row({ type: 'TI' }), row({ type: 'TU' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { ratio: '200/5' });
  eq(out.map(r => r.ratio), ['200/5', '300/5', '200/5', ''],
    'L1: nhập tỷ số ⇒ lan sang TI còn TRỐNG, không đè TI đã có, không đụng TU');
}

/* ------------------------------------------- Luật 2: ngày treo lan cả bộ */
{
  const rows = [
    row({ type: 'CONGTO', serial: 'CT-1' }),
    row({ type: 'TI' }),
    row({}),                                       // dòng trắng tinh
    row({ type: 'TI', serial: 'TI-BUSY' }),        // dòng mới mang thiết bị treo nơi khác
    row({ type: 'TI', dateOn: '2025-01-01', dateOff: '2025-06-01' }),
  ];
  const out = applyRowRules(ctx, rows, rows[0].key, { dateOn: '2026-11-17' });
  eq(out.map(r => r.dateOn), ['2026-11-17', '2026-11-17', '', '', '2025-01-01'],
    'L2: lan ngày treo cho dòng đã khai, bỏ dòng trắng, bỏ dòng bị khoá, không đè dòng đã có ngày');
}

/* ------------------------------------- Luật 3: vật tư mới thay vật tư cũ */
{
  const rows = [
    row({ id: 'o1', type: 'CONGTO', serial: 'OLD', dateOn: '2025-01-01' }),
    row({ id: 'o2', type: 'TI', serial: 'T-OLD', dateOn: '2025-01-01' }),
    row({ id: 'o3', type: 'CONGTO', serial: 'SAME', dateOn: '2026-11-17' }),
    row({ id: 'o4', type: 'CONGTO', serial: 'DONE', dateOn: '2025-01-01', dateOff: '2025-12-31' }),
    row({ type: 'CONGTO', serial: 'CT-1' }),
  ];
  const out = applyRowRules(ctx, rows, rows[4].key, { dateOn: '2026-11-17' });
  eq(pick(out, ['serial', 'dateOff', 'active']), [
    { serial: 'OLD', dateOff: '2026-11-17', active: false },
    { serial: 'T-OLD', dateOff: '', active: true },
    { serial: 'SAME', dateOff: '', active: true },
    { serial: 'DONE', dateOff: '2025-12-31', active: false },
    { serial: 'CT-1', dateOff: '', active: true },
  ], 'L3: công tơ cũ nhận ngày tháo; khác loại, cùng ngày, đã tháo thì giữ nguyên');
}

/* ------------------------------- Luật 4: số No đang treo ở điểm đo khác */
{
  const rows = [row({ id: 'saved', type: 'CONGTO', serial: '' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'CT-BUSY' });
  eq(out[0].dateOff, '2026-05-01', 'L4: dòng ĐÃ LƯU ⇒ ngày tháo = ngày treo bên kia');
  eq(out[0].active, false, 'L4: kèm theo là thôi hoạt động');
}
{
  const rows = [row({ id: 'saved', type: 'CONGTO', serial: '', dateOff: '2026-01-01' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'CT-BUSY' });
  eq(out[0].dateOff, '2026-01-01', 'L4: không đè ngày tháo đã khai');
}
{
  const rows = [row({ type: 'CONGTO', dateOn: '2026-11-17' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'CT-BUSY' });
  eq(pick(out, ['dateOn', 'dateOff']), [{ dateOn: '', dateOff: '' }],
    'L4: dòng MỚI chọn thiết bị treo nơi khác ⇒ xoá ngày treo đã gõ, không tự điền ngày tháo');
}

/* ------------------------------ Luật 5: lấy loại + tỷ số từ Kho vật tư */
{
  const rows = [row({ type: 'CONGTO', ratio: '1/1' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'TI-C' });
  eq(pick(out, ['type', 'ratio']), [{ type: 'TI', ratio: '300/5' }],
    'L5: dòng MỚI ⇒ loại và tỷ số LUÔN theo thiết bị');
}
{
  const rows = [row({ type: 'TI', ratio: '9/9' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'CT-1' });
  eq(pick(out, ['type', 'ratio']), [{ type: 'CONGTO', ratio: '' }], 'L5: công tơ không có tỷ số');
}
{
  const rows = [row({ id: 's', type: 'TI', ratio: '150/5' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'TI-A' });
  eq(out[0].ratio, '150/5', 'L5: dòng ĐÃ LƯU giữ tỷ số cũ, chỉ điền ô trống');
}
{
  const rows = [row({ id: 's', type: 'TI', ratio: '' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { serial: 'TI-A' });
  eq(out[0].ratio, '200/5', 'L5: dòng ĐÃ LƯU trống tỷ số ⇒ lấy theo kho');
}
{
  const rows = [row({ type: 'TI', serial: 'TI-A', ratio: '200/5' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { type: 'CONGTO' });
  eq(pick(out, ['serial', 'ratio']), [{ serial: '', ratio: '' }],
    'L5: dòng MỚI đổi sang loại khác loại thiết bị ⇒ bỏ số No');
}
{
  const rows = [row({ id: 's', type: 'TI', serial: 'TI-A', ratio: '200/5' })];
  const out = applyRowRules(ctx, rows, rows[0].key, { type: 'CONGTO' });
  eq(out[0].serial, 'TI-A', 'L5: dòng ĐÃ LƯU đổi loại thì không xoá số No');
}

/* ---------------------------------------------------- applySet, addRow */
{
  const rows = [row({ id: 'k', type: 'CONGTO', serial: 'CT-1' }), row({})];
  const out = applySet(rows, { ti: '200/5', tiFree: 3, tuFree: 0 });
  eq(pick(out, ['type', 'ratio', 'want']), [
    { type: 'CONGTO', ratio: '', want: undefined },
    { type: 'TI', ratio: '200/5', want: '200/5' },
    { type: 'TI', ratio: '200/5', want: '200/5' },
    { type: 'TI', ratio: '200/5', want: '200/5' },
  ].map(o => JSON.parse(JSON.stringify(o))), 'applySet: thêm đủ bộ 3 TI, dọn dòng trắng');
}
{
  const out = applySet([], { ti: '100/5', tu: '22000/110', tiFree: 3, tuFree: 1 });
  eq(out.map(r => r.type), ['TI', 'TI', 'TI', 'TU'], 'applySet: bộ có TU ⇒ thêm 1 dòng TU');
}
{
  const rows = [row({ type: 'TI', ratio: '200/5' })];
  const out = addRow(ctx, rows, 'TI');
  eq(pick(out, ['type', 'ratio']), [{ type: 'TI', ratio: '200/5' }, { type: 'TI', ratio: '200/5' }],
    'addRow: thêm dòng TI ⇒ thừa hưởng tỷ số bộ');
  eq(new Set(out.map(r => r.key)).size, 2, 'addRow: khoá dòng không trùng');
}

/* ---------------------------------------------------------------- kết quả */

if (fails.length) {
  console.error(`✗ ${fails.length} ca SAI, ${pass} ca đúng:\n`);
  for (const f of fails) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${pass} ca đúng — luật bảng vật tư form điểm đo`);
