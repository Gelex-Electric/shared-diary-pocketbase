/**
 * Bộ kiểm thử GHI điểm đo — chạy: npx tsx scripts/dm_test_point_save.ts
 *
 * Dùng repo GIẢ ghi lại thứ tự lời gọi; không đụng PocketBase. Thứ tự là nghiệp
 * vụ (vd đổi chỗ phải trước khi ghi vật tư vì `(serial, point)` UNIQUE).
 */

import { savePoint, type SaveRepo } from '../src/lib/dm/pointSave';
import { newRow, type AssetRow } from '../src/lib/dm/pointForm';
import type { PointCheck } from '../src/lib/dm/pointCheck';
import type { CatalogData } from '../src/lib/dm/repo';
import type { Asset, AssetType, Device } from '../src/lib/dm/types';

let pass = 0;
const fails: string[] = [];
function eq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) { pass++; return; }
  fails.push(`${label}\n     mong đợi: ${b}\n     nhận được: ${a}`);
}

type Call = [string, ...unknown[]];
function fakeRepo(newId = 'P-NEW') {
  const calls: Call[] = [];
  const rec = (name: string, ret?: unknown) => async (...args: unknown[]) => { calls.push([name, ...args]); return ret; };
  const repo: SaveRepo = {
    points: { create: rec('points.create', { id: newId }), update: async (id, data) => { calls.push(['points.update', id, data]); return { id }; } },
    assets: { create: rec('assets.create'), update: rec('assets.update'), remove: rec('assets.remove') },
    devices: { update: rec('devices.update') },
    borrows: { create: rec('borrows.create') },
  };
  return { repo, calls, names: () => calls.map(c => c[0]) };
}

const dev = (type: AssetType, serial: string, ratio?: [number, number], extra: Partial<Device> = {}): Device =>
  ({ id: `dev-${serial}`, serial, type, ratio_primary: ratio?.[0], ratio_secondary: ratio?.[1], ...extra }) as Device;
const asset = (id: string, serial: string, type: AssetType, point: string, on = '', extra: Partial<Asset> = {}): Asset =>
  ({ id, serial, type, point, device: `dev-${serial}`, date_on: on, date_off: '', active: true, ...extra }) as Asset;
const row = (type: AssetType, serial: string, p: Partial<AssetRow> = {}): AssetRow =>
  ({ ...newRow(type), serial, ...p, active: !(p.dateOff ?? '').trim() });

const D: CatalogData = {
  zones: [], lines: [], stations: [], customers: [], points: [], borrows: [],
  devices: [
    dev('CONGTO', 'CT1'), dev('TI', 'TI1', [200, 5]),
    dev('CONGTO', 'CT-HOLD', undefined, { hold_point: 'P-OTHER' }),
    dev('CONGTO', 'CT-OLD', undefined, { hold_point: 'P-ME' }),
    dev('CONGTO', 'CT-GONE', undefined, { hold_point: 'P-ME' }),
  ],
  assets: [
    asset('a-hold', 'CT-HOLD', 'CONGTO', 'P-OTHER'),
    asset('a-gone', 'CT-GONE', 'CONGTO', 'P-ME'),
  ],
};
const TODAY = '2026-11-17';
const BODY = { code: 'X', hsn: 40 };
type Reclaim = PointCheck['reclaim'];
const rc = (serial: string, a: Asset, swapTo = ''): Reclaim[number] =>
  ({ serial, asset: a, code: 'TH.OTHER', swapTo }) as Reclaim[number];

/* ------------------------------------------------- tạo mới, không đụng ai */
{
  const f = fakeRepo();
  const id = await savePoint({ repo: f.repo, d: D, editingId: null, body: BODY, reclaim: [], today: TODAY,
    assetRows: [row('CONGTO', 'CT1', { dateOn: '2026-11-01' }), row('TI', 'TI1', { ratio: '200/5' }), row('TI', '')] });
  eq(id, 'P-NEW', 'tạo mới ⇒ trả id điểm đo vừa tạo');
  eq(f.names(), ['points.create', 'assets.create', 'devices.update', 'assets.create'],
    'tạo mới ⇒ ghi điểm đo trước, rồi vật tư; dòng chưa số No bỏ qua');
  eq(f.calls[2], ['devices.update', 'dev-TI1', { hold_point: 'P-NEW' }], 'dòng chưa ngày treo ⇒ giữ chỗ thiết bị cho điểm đo');
  eq(f.calls[3][1], {
    serial: 'TI1', type: 'TI', device: 'dev-TI1', point: 'P-NEW', ratio_primary: 200, ratio_secondary: 5,
    date_on: '', date_off: '', active: true, status: 'dang_treo',
  }, 'bản ghi dm_asset của TI: tỷ số tách 2 số, trỏ đúng thiết bị');
  eq((f.calls[1][1] as Asset).ratio_primary, undefined, 'công tơ không ghi tỷ số');
}

/* ------------------------------------- sửa: gỡ dòng bị xoá + bỏ giữ chỗ */
{
  const f = fakeRepo();
  await savePoint({ repo: f.repo, d: D, editingId: 'P-ME', body: BODY, reclaim: [], today: TODAY,
    assetRows: [row('CONGTO', 'CT1', { dateOn: '2026-11-01', dateOff: '2026-11-10' })] });
  eq(f.names(), ['points.update', 'assets.remove', 'devices.update', 'assets.create'],
    'sửa ⇒ cập nhật điểm đo, gỡ dòng không còn trên form, bỏ giữ chỗ của nó');
  eq(f.calls[2], ['devices.update', 'dev-CT-GONE', { hold_point: '' }], 'bỏ giữ chỗ đúng thiết bị');
  eq([(f.calls[3][1] as Asset).active, (f.calls[3][1] as Asset).status], [false, 'thao_go'], 'có ngày tháo ⇒ thao_go');
}

/* --------------------------------------------------- CHUYỂN (không số cũ) */
{
  const f = fakeRepo();
  await savePoint({ repo: f.repo, d: D, editingId: null, body: BODY, today: TODAY,
    reclaim: [rc('CT-HOLD', D.assets[0])], assetRows: [row('CONGTO', 'CT-HOLD', { dateOn: '2026-11-01' })] });
  eq(f.names(), ['assets.remove', 'points.create', 'borrows.create', 'devices.update', 'assets.create'],
    'chuyển ⇒ gỡ dòng bên kia TRƯỚC, ghi điểm đo, ghi sổ mượn, rồi vật tư');
  eq(f.calls[0], ['assets.remove', 'a-hold'], 'gỡ đúng dòng bên kia');
  eq(f.calls[2][1], { device: 'dev-CT-HOLD', from_point: 'P-OTHER', to_point: 'P-NEW',
    borrowed_at: TODAY, reason: 'Chuyển ở form điểm đo' }, 'sổ mượn: từ điểm kia sang điểm này');
}

/* -------------------------------------------------------------- ĐỔI CHỖ */
{
  const f = fakeRepo();
  await savePoint({ repo: f.repo, d: D, editingId: 'P-ME', body: BODY, today: TODAY,
    reclaim: [rc('CT-HOLD', D.assets[0], 'CT-OLD')], assetRows: [row('CONGTO', 'CT-HOLD', { id: 'a-gone' })] });
  eq(f.calls.slice(0, 2), [
    ['assets.update', 'a-hold', { serial: 'CT-OLD', device: 'dev-CT-OLD', type: 'CONGTO', ratio_primary: undefined, ratio_secondary: undefined }],
    ['devices.update', 'dev-CT-OLD', { hold_point: 'P-OTHER' }],
  ].map(x => JSON.parse(JSON.stringify(x))), 'đổi chỗ ⇒ bên kia nhận số cũ + thiết bị, giữ chỗ đi theo');
  eq(f.names().includes('borrows.create'), false, 'đổi chỗ ⇒ không ghi sổ mượn');
}

/* --------------------------------------------------- số No ngoài kho */
{
  const f = fakeRepo();
  let err = '';
  try {
    await savePoint({ repo: f.repo, d: D, editingId: null, body: BODY, reclaim: [], today: TODAY,
      assetRows: [row('CONGTO', 'NOPE', { dateOn: '2026-11-01' })] });
  } catch (e) { err = (e as Error).message; }
  eq(err.includes('NOPE chưa có trong Kho vật tư'), true, 'số No ngoài kho ⇒ ném lỗi, không tạo thiết bị ngầm');
  eq(f.names().includes('assets.create'), false, 'không ghi vật tư khi số No ngoài kho');
}

/* ---------------------------------------------------------------- kết quả */

if (fails.length) {
  console.error(`✗ ${fails.length} ca SAI, ${pass} ca đúng:\n`);
  for (const f of fails) console.error(`  - ${f}\n`);
  process.exit(1);
}
console.log(`✓ ${pass} ca đúng — ghi điểm đo`);
