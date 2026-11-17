/**
 * Bộ kiểm thử KIỂM TRA FORM ĐIỂM ĐO — chạy: npx tsx scripts/dm_test_point_check.ts
 *
 * Chỉ import `src/lib/dm/pointCheck.ts` (thuần, không đụng PocketBase). Mỗi nhóm
 * CHẶN LƯU có một ca chặn và một ca qua; ca đỏ nghĩa là đã lỡ đổi nghiệp vụ.
 */

import { checkPointForm, type PointCheckInput, type PointFormLike } from '../src/lib/dm/pointCheck';
import { hsnSig, newRow, type AssetRow } from '../src/lib/dm/pointForm';
import type { CatalogData } from '../src/lib/dm/repo';
import type { Segment } from '../src/lib/dm/lifecycle';
import type { Asset, AssetType, Device, Point } from '../src/lib/dm/types';

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n     mong đợi: ${b}\n     nhận được: ${a}`);
}
const has = (list: string[], part: string, label: string) =>
  eq(list.some(s => s.includes(part)), true, `${label} — cần có "${part}" trong ${JSON.stringify(list)}`);
const hasNot = (list: string[], part: string, label: string) =>
  eq(list.some(s => s.includes(part)), false, `${label} — KHÔNG được có "${part}" trong ${JSON.stringify(list)}`);

/* ------------------------------------------------------------- dữ liệu mẫu */

const dev = (type: AssetType, serial: string, ratio?: [number, number], extra: Partial<Device> = {}): Device =>
  ({ id: `dev-${serial}`, serial, type, ratio_primary: ratio?.[0], ratio_secondary: ratio?.[1], ...extra }) as Device;
const asset = (serial: string, type: AssetType, point: string, on: string, off = '', extra: Partial<Asset> = {}): Asset =>
  ({ id: `as-${serial}-${point}`, serial, type, point, device: `dev-${serial}`,
     date_on: on, date_off: off, active: !off, ...extra }) as Asset;

const BASE: CatalogData = {
  zones: [{ id: 'z1', code: 'KCNTH', name: 'KCN Tiền Hải' }] as CatalogData['zones'],
  lines: [{ id: 'l1', code: '471-E1', zone: 'z1' }] as CatalogData['lines'],
  stations: [{ id: 's1', code: 'TH.ABC.T1.400KVA', zone: 'z1', customer: 'c1', ident: 'T1', sdm_kva: 400 }] as CatalogData['stations'],
  customers: [
    { id: 'c1', mkh: 'KCNTH-001', name: 'Công ty ABC', short_name: 'ABC' },
    { id: 'c2', mkh: 'KCNTH-002', name: 'Công ty XYZ', short_name: 'XYZ' },
  ] as CatalogData['customers'],
  points: [
    { id: 'p-other', code: 'TH.OTHER.T1.250KVA', station: 's1', role: 'chinh' },
    { id: 'p-plan', code: 'TH.PLAN.T1.250KVA', station: 's1', role: 'chinh' },
    { id: 'p-head', code: 'HEAD', role: 'dau_nguon', line: 'l1' },
  ] as Point[],
  devices: [
    dev('CONGTO', 'CT1'), dev('CONGTO', 'CT2'), dev('CONGTO', 'CT-BUSY'), dev('CONGTO', 'CT-HOLD'),
    dev('CONGTO', 'CT-OLD'),
    dev('TI', 'TI1', [200, 5]), dev('TI', 'TI2', [200, 5]), dev('TI', 'TI3', [200, 5]),
    dev('TI', 'TI4', [300, 5]), dev('TI', 'TI5', [300, 5]), dev('TI', 'TI6', [300, 5]),
  ],
  assets: [
    asset('CT-BUSY', 'CONGTO', 'p-other', '2026-05-01'),     // đang treo thật ở điểm khác
    asset('CT-HOLD', 'CONGTO', 'p-plan', ''),                // dự kiến ở điểm khác
  ],
  borrows: [],
};

const form = (p: Partial<PointFormLike> = {}): PointFormLike => ({
  station: 's1', role: 'chinh', line: '', customer: '', parent_point: '', ident: '',
  hsn: '1', purpose: '', purpose_custom: '', assetRows: [], ...p,
});
const r = (type: AssetType, serial: string, p: Partial<AssetRow> = {}): AssetRow =>
  ({ ...newRow(type), serial, ratio: '', ...p, active: !(p.dateOff ?? '').trim() });
const run = (p: Partial<PointCheckInput> & { pForm: PointFormLike }) => checkPointForm({
  d: BASE, editingId: null, regenCode: false, pSnap: '', pointMkh: 'KCNTH-001',
  invSegs: {}, mkhSerials: {}, ...p,
});

const ON = '2026-11-01';
const TI200 = (p: Partial<AssetRow> = {}) =>
  ['TI1', 'TI2', 'TI3'].map(s => r('TI', s, { ratio: '200/5', dateOn: ON, ...p }));

/* --------------------------------------------------------------- ca hợp lệ */
{
  const c = run({ pForm: form({ hsn: '40', assetRows: [r('CONGTO', 'CT1', { dateOn: ON }), ...TI200()] }) });
  eq(c.saveBlocks, [], 'hợp lệ: công tơ + bộ 3 TI 200/5, HSN 40 ⇒ không chặn');
  eq(c.derivedHsn, 40, 'hợp lệ: HSN suy từ TI = 40');
  eq(c.effectiveHsn, 40, 'hợp lệ: HSN ghi xuống = HSN nhập tay');
  eq(c.pointCodeMissing, [], 'hợp lệ: đủ mảnh sinh mã');
  eq(c.derivedStatus, 'chua_van_hanh', 'hợp lệ: đủ ngày treo, chưa hóa đơn ⇒ chưa vận hành');
}

/* ---------------------------------------------------------------- HSN */
has(run({ pForm: form({ hsn: '' }) }).saveBlocks, 'chưa nhập HSN', 'HSN trống ⇒ chặn');
has(run({ pForm: form({ hsn: 'abc' }) }).saveBlocks, 'không hợp lệ', 'HSN chữ ⇒ chặn');
{
  const rows = [r('CONGTO', 'CT1', { dateOn: ON }), ...TI200()];
  const c = run({ pForm: form({ hsn: '60', assetRows: rows }) });
  has(c.saveBlocks, 'không khớp HSN nhập 60', 'HSN 60 mà bộ TI 200/5 ⇒ chặn');
  eq(c.hsnMismatch, true, 'hsnMismatch bật');
  const old = run({ pForm: form({ hsn: '60', assetRows: rows }), editingId: 'p-x', pSnap: hsnSig('60', rows) });
  hasNot(old.saveBlocks, 'không khớp HSN', 'điểm đo CŨ lệch sẵn, chưa sửa HSN/vật tư ⇒ không chặn');
}
{
  const c = run({ pForm: form({ hsn: '1', assetRows: [r('CONGTO', 'CT1', { dateOn: ON }), ...TI200()] }) });
  has(c.saveBlocks, 'HSN = 1 (đo thẳng) nhưng điểm đo đang có TI', 'HSN 1 mà có TI ⇒ chặn');
}
{
  const c = run({ pForm: form({ hsn: '200', assetRows: [r('CONGTO', 'CT1', { dateOn: ON })] }) });
  hasNot(c.saveBlocks, 'HSN', 'HSN > 1 chưa khai TI ⇒ cho lưu (TI bổ sung sau)');
  has(c.assetWarnings, 'chưa khai TI', 'HSN > 1 chưa khai TI ⇒ nhắc');
  eq(c.setSuggestions.map(s => s.ti), [], 'gợi ý bộ TI cho HSN 200: kho không có 1000/5 ⇒ rỗng');
}
eq(run({ pForm: form({ hsn: '40' }) }).setSuggestions.map(s => s.ti), ['200/5'],
  'gợi ý bộ TI cho HSN 40 ⇒ bộ 200/5 còn rảnh');

/* --------------------------------------------------------------- tỷ số */
{
  const rows = [r('CONGTO', 'CT1', { dateOn: ON }), r('TI', 'TI1', { dateOn: ON })];
  has(run({ pForm: form({ hsn: '40', assetRows: rows }) }).saveBlocks, 'chưa nhập tỷ số', 'TI thiếu tỷ số ⇒ chặn');
}
{
  const rows = [r('CONGTO', 'CT1', { dateOn: ON }), r('TI', 'TI1', { ratio: '200/0', dateOn: ON })];
  has(run({ pForm: form({ hsn: '40', assetRows: rows }) }).saveBlocks, 'tỷ số không hợp lệ', 'TI tỷ số 200/0 ⇒ chặn');
}

/* ---------------------------------------------------------- số No / kho */
has(run({ pForm: form({ assetRows: [r('CONGTO', 'NOPE', { dateOn: ON })] }) }).saveBlocks,
  'chưa có trong Kho vật tư', 'số No ngoài kho ⇒ chặn');
has(run({ pForm: form({ assetRows: [r('CONGTO', 'CT1', { dateOn: ON }), r('CONGTO', 'CT1', { dateOn: ON })] }) }).saveBlocks,
  'bị khai 2 lần', 'trùng số No trong form ⇒ chặn');
{
  const c = run({ pForm: form({ assetRows: [r('CONGTO', 'CT-BUSY', { dateOn: ON })] }) });
  has(c.saveBlocks, 'còn đang treo ở điểm đo khác', 'dòng mới có ngày treo, thiết bị đang treo nơi khác ⇒ chặn');
  has(c.saveBlocks, 'TH.OTHER.T1.250KVA', 'nêu đúng điểm đo đang treo');
}
{
  const c = run({ pForm: form({ assetRows: [r('CONGTO', 'CT-BUSY')] }) });
  hasNot(c.saveBlocks, 'đang treo ở', 'dòng mới DỰ KIẾN giữ thiết bị đang treo nơi khác ⇒ không chặn đụng độ');
}

/* ------------------------------------------------- chuyển / đổi chỗ dự kiến */
{
  const c = run({ pForm: form({ assetRows: [r('CONGTO', 'CT-HOLD', { dateOn: ON })] }) });
  eq(c.reclaim.map(b => [b.serial, b.swapTo]), [['CT-HOLD', '']], 'thiết bị dự kiến ở điểm khác ⇒ CHUYỂN');
  has(c.assetWarnings, 'CHUYỂN về đây', 'chuyển ⇒ báo trước bên kia mất dòng');
  hasNot(c.saveBlocks, 'CT-HOLD đang treo', 'chuyển dự kiến ⇒ không chặn');
}
{
  // Cả hai điểm đo cùng dự kiến, dòng đang sửa vốn giữ CT-OLD ⇒ ĐỔI CHỖ.
  const d: CatalogData = { ...BASE, assets: [...BASE.assets, asset('CT-OLD', 'CONGTO', 'p-me', '', '', { id: 'mine' })] };
  const c = run({ d, editingId: 'p-me', pForm: form({ assetRows: [r('CONGTO', 'CT-HOLD', { id: 'mine' })] }) });
  eq(c.reclaim.map(b => [b.serial, b.swapTo]), [['CT-HOLD', 'CT-OLD']], 'hai điểm cùng dự kiến ⇒ ĐỔI CHỖ');
  has(c.assetWarnings, 'ĐỔI CHỖ', 'đổi chỗ ⇒ báo bên kia nhận số nào');
}

/* --------------------------------------------- ngày treo, trần, trạng thái */
has(run({ pForm: form({ assetRows: [r('CONGTO', 'CT1')] }) }).saveBlocks,
  'phải có ngày treo', 'dòng mới thiếu ngày treo ⇒ chặn (dự kiến là việc của Nhóm Vật Tư)');
{
  const d: CatalogData = { ...BASE, assets: [...BASE.assets, asset('CT2', 'CONGTO', 'p-me', '')] };
  const c = run({ d, editingId: 'p-me', pForm: form({ assetRows: [r('CONGTO', 'CT2', { id: 'as-CT2-p-me' })] }) });
  hasNot(c.saveBlocks, 'phải có ngày treo', 'dòng NHU CẦU đã lưu chưa ngày treo ⇒ không chặn');
  eq([c.needRows.length, c.treoRows.length], [1, 0], 'dòng nhu cầu tách khỏi bảng treo tháo');
}
has(run({ pForm: form({ assetRows: [r('CONGTO', 'CT1', { dateOn: ON }), r('CONGTO', 'CT2', { dateOn: ON })] }) }).saveBlocks,
  'tối đa 1', 'hai công tơ cùng treo ⇒ vượt trần, chặn');
{
  const c = run({ pForm: form({ assetRows: [] }) });
  eq([c.derivedStatus, c.statusReason], ['du_kien', 'Chưa khai công tơ nào.'], 'chưa có công tơ ⇒ dự kiến');
  has(c.assetWarnings, 'chưa có công tơ đang hoạt động', 'chưa có công tơ ⇒ nhắc');
}

/* --------------------------------------------------------- mã điểm đo */
{
  const code = run({ pForm: form() }).pointCode;
  eq(code.length > 0, true, 'sinh được mã điểm đo chính');
  const d: CatalogData = { ...BASE, points: [...BASE.points, { id: 'p-dup', code, station: 's1', role: 'chinh', customer: 'c2' } as Point] };
  has(run({ d, pForm: form() }).saveBlocks, 'đã thuộc về một điểm đo khác', 'mã trùng điểm đo khác ⇒ chặn');
  const locked: CatalogData = { ...BASE, points: [...BASE.points,
    { id: 'p-moved', code: 'MA.CU', station: 's1', role: 'chinh', owner_history: [{}] } as unknown as Point] };
  eq(run({ d: locked, editingId: 'p-moved', pForm: form() }).pointCode, 'MA.CU',
    'điểm đo từng chuyển chủ ⇒ giữ mã đã lưu');
  eq(run({ d: locked, editingId: 'p-moved', regenCode: true, pForm: form() }).pointCode, code,
    'bấm "Sinh lại mã" ⇒ sinh mã mới');
}
{
  const c = run({ pForm: form({ role: 'phu', customer: 'c2' }) });
  eq(c.isSub && c.subLabel === 'XYZ', true, 'điểm phụ khách khác ⇒ đuôi mã = tên tắt KH phụ');
  eq(run({ pForm: form({ role: 'phu', customer: 'c1' }) }).pointCodeMissing.length > 0, true,
    'điểm phụ trùng KH điểm chính, chưa nhãn ⇒ thiếu mảnh mã');
}
eq(run({ pForm: form({ role: 'dau_nguon', line: 'l1', station: '' }) }).lineHeadTaken, true,
  'lộ đã có điểm đầu nguồn ⇒ lineHeadTaken');
eq(run({ pForm: form({ role: 'dau_nguon', line: 'l1', station: '' }), editingId: 'p-head' }).lineHeadTaken, false,
  'sửa chính điểm đầu nguồn đó ⇒ không tính là trùng');

/* ------------------------------------------------------- đối chiếu hóa đơn */
{
  const seg = (mkh: string, from: string, to: string, hsn = 40, isCurrent = true): Segment =>
    ({ mkh, from, to, count: 3, hsn, hsnHistory: [hsn], isCurrent });
  const rows = [r('CONGTO', 'CT1', { dateOn: ON }), ...TI200()];
  const ok = run({ pForm: form({ hsn: '40', assetRows: rows }), invSegs: { CT1: [seg('KCNTH-001', '2026-11-01', '2026-11-16')] } });
  eq([ok.invoiceNotes, ok.refHsn, ok.derivedStatus], [[], 40, 'active'],
    'hóa đơn đúng khách, đúng quãng, cùng HSN ⇒ im lặng, đang vận hành');
  const other = run({ pForm: form({ hsn: '40', assetRows: rows }), invSegs: { CT1: [seg('KCNTH-002', '2026-10-01', '2026-11-16')] } });
  has(other.invoiceNotes, 'KHÔNG có chặng nào của KCNTH-001', 'hóa đơn khách khác trong quãng treo ⇒ nhắc');
  const before = run({ pForm: form({ hsn: '40', assetRows: rows }), invSegs: { CT1: [seg('KCNTH-002', '2026-01-01', '2026-03-01')] } });
  has(before.invoiceNotes, 'trước đây chạy cho KCNTH-002', 'chặng khách khác đã kết thúc trước ⇒ chỉ thông tin');
  const hsn = run({ pForm: form({ hsn: '40', assetRows: rows }), invSegs: { CT1: [seg('KCNTH-001', '2026-11-01', '2026-11-16', 60)] } });
  has(hsn.invoiceNotes, 'hóa đơn ghi 60', 'HSN nhập lệch HSN hóa đơn ⇒ nhắc');
  eq(hsn.invoiceHsn, 60, 'invoiceHsn lấy theo công tơ đang hoạt động');
}

/* ---------------------------------------------------------------- kết quả */

if (fails.length) {
  console.error(`✗ ${fails.length} ca SAI, ${pass} ca đúng:\n`);
  for (const f of fails) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${pass} ca đúng — kiểm tra form điểm đo`);
