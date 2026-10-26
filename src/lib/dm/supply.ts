/**
 * Luồng CẤP VẬT TƯ cho điểm đo mới — module THUẦN, không mạng, không JSX.
 * Plan `plans/2026-10-26-luong-cap-vat-tu-diem-do-moi.md` (user duyệt 26/10/2026).
 *
 *   KD khai nhu cầu → Vật Tư phân bổ / đặt mua → Vận Hành treo
 *
 * Mọi thứ ở đây SUY RA từ dữ liệu, không lưu: đủ/thiếu, trạng thái quy trình.
 * Lưu sẵn thì chắc chắn lệch với vật tư thật đang gắn (cùng lý do `dm_device`
 * bỏ cột `status` ở schema v14).
 *
 * "Đã phân bổ" = lần lắp `dm_asset` ở điểm đo chưa có ngày tháo — gồm cả dòng
 * DỰ KIẾN (chưa ngày treo) lẫn dòng đã treo. Đúng cơ chế "Gắn vào điểm đo" đang
 * dùng, không đẻ khái niệm phân bổ thứ hai.
 *
 * Test: `npx tsx scripts/dm_test_supply.ts`.
 */
import { formatRatio } from './hsn';
import { TI_PER_SET } from './pointStatus';
import type {
  Asset, AssetType, Borrow, Connection, Device, NeedLine, Point, PurchaseLine, Purchase, TiShape,
} from './types';

const ymd = (v?: string | null): string => (v ?? '').slice(0, 10);

/** Loại có tỷ số — TI, TU. Loại khác bỏ qua tỷ số khi khớp. */
export const HAS_RATIO: AssetType[] = ['TI', 'TU'];

/* ------------------------------ quy cách ------------------------------ */

type Spec = Pick<NeedLine, 'type' | 'ratio_primary' | 'ratio_secondary' | 'shape'>;

/** Khoá gom theo QUY CÁCH: loại + tỷ số (TI/TU) + hình dạng (TI). */
export function specKey(s: Spec): string {
  const ratio = HAS_RATIO.includes(s.type) ? formatRatio(s.ratio_primary, s.ratio_secondary) : '';
  const shape = s.type === 'TI' ? (s.shape || '') : '';
  return `${s.type}|${ratio}|${shape}`;
}

export type MatchResult = 'yes' | 'unsure_shape' | 'no';

/**
 * Thiết bị có khớp dòng nhu cầu không.
 * - Khác loại / khác tỷ số ⇒ không.
 * - Nhu cầu chưa ghi tỷ số ⇒ tỷ số nào cũng được.
 * - TI: nhu cầu có hình dạng mà thiết bị CHƯA RÕ hình dạng ⇒ `unsure_shape` —
 *   VẪN tính là khớp (501 TI cũ chưa khai hình dạng; chặn thì không phân bổ
 *   được gì), nhưng phải hiện cảnh báo. Khác hình dạng rõ ràng ⇒ không.
 */
export function matchDevice(
  d: Pick<Device, 'type' | 'ratio_primary' | 'ratio_secondary' | 'shape'>, n: Spec,
): MatchResult {
  if (d.type !== n.type) return 'no';
  if (HAS_RATIO.includes(n.type) && n.ratio_primary != null) {
    if (d.ratio_primary !== n.ratio_primary) return 'no';
    if (n.ratio_secondary != null && d.ratio_secondary !== n.ratio_secondary) return 'no';
  }
  if (n.type === 'TI' && n.shape) {
    if (!d.shape) return 'unsure_shape';
    if (d.shape !== n.shape) return 'no';
  }
  return 'yes';
}

/* --------------------------- nhu cầu mặc định --------------------------- */

/**
 * Gợi ý tỷ số TI từ HSN cho điểm đo HẠ ÁP (không TU): HSN 200 ⇒ 1000/5.
 * HSN ≤ 1 hoặc không có ⇒ không gợi ý. Có TU thì HSN là tích hai tỷ số, không
 * tách ngược được — để người khai tự chọn.
 */
export function suggestTiRatio(hsn?: number | null): { ratio_primary: number; ratio_secondary: number } | null {
  if (!hsn || !Number.isFinite(hsn) || hsn <= 1) return null;
  return { ratio_primary: Math.round(hsn * 5 * 1000) / 1000, ratio_secondary: 5 };
}

/**
 * Bộ nhu cầu điền sẵn theo kiểu đấu nối (user chốt 26/10/2026):
 * gián tiếp = 3 TI + công tơ + GP-03 + SIM; trực tiếp = công tơ + GP-03 + SIM.
 * Trung áp KHÔNG tự thêm TU — số TU (2 hay 3) tuỳ sơ đồ, người khai tự thêm.
 */
export function defaultNeed(connection: Connection, hsn?: number | null, mv = false): NeedLine[] {
  const base: NeedLine[] = [
    { type: 'CONGTO', qty: 1 },
    { type: 'GP03', qty: 1 },
    { type: 'SIM', qty: 1 },
  ];
  if (connection !== 'gian_tiep') return base;
  const ratio = mv ? null : suggestTiRatio(hsn);
  return [{ type: 'TI', qty: TI_PER_SET, shape: '', ...(ratio ?? {}) }, ...base];
}

/** Bỏ dòng hỏng (số lượng ≤ 0) và tỷ số/hình dạng thừa ở loại không dùng tới — gọi trước khi lưu. */
export function cleanNeed(need: NeedLine[] | null | undefined): NeedLine[] {
  return (need ?? [])
    .filter(n => n && n.type && Number.isFinite(n.qty) && n.qty > 0)
    .map(n => {
      const out: NeedLine = { type: n.type, qty: Math.floor(n.qty) };
      if (HAS_RATIO.includes(n.type) && n.ratio_primary != null) {
        out.ratio_primary = n.ratio_primary;
        if (n.ratio_secondary != null) out.ratio_secondary = n.ratio_secondary;
      }
      if (n.type === 'TI' && n.shape) out.shape = n.shape as TiShape;
      if (n.note?.trim()) out.note = n.note.trim();
      return out;
    });
}

/* ----------------------------- đủ / thiếu ----------------------------- */

export interface LineSupply {
  line: NeedLine;
  /** Lần lắp đã đếm cho dòng này. */
  have: Asset[];
  /** Còn thiếu bao nhiêu (≥ 0). */
  missing: number;
  /** Trong `have`, bao nhiêu TI chưa rõ hình dạng (khớp tạm). */
  unsureShape: number;
}

/** Lần lắp còn thuộc điểm đo: chưa ngày tháo (dự kiến hoặc đang treo). */
export const allocatedAssets = (assets: Asset[], pointId: string): Asset[] =>
  assets.filter(a => a.point === pointId && !ymd(a.date_off));

/** Thiết bị của một lần lắp — theo `device`, không có thì theo số No. */
function deviceIndex(devices: Device[]) {
  const byId = new Map(devices.map(d => [d.id, d]));
  const bySerial = new Map(devices.map(d => [d.serial.trim(), d]));
  return (a: Asset): Pick<Device, 'type' | 'ratio_primary' | 'ratio_secondary' | 'shape'> =>
    (a.device && byId.get(a.device)) || bySerial.get((a.serial ?? '').trim())
      // Lần lắp chưa nối thiết bị: dùng chính thông tin chép trên dòng.
      || { type: a.type, ratio_primary: a.ratio_primary, ratio_secondary: a.ratio_secondary, shape: '' };
}

/**
 * Chia lần lắp của điểm đo vào từng dòng nhu cầu.
 * Dòng CỤ THỂ hơn (có tỷ số, có hình dạng) chọn trước, để dòng "TI bất kỳ" không
 * giành mất cái TI duy nhất khớp đúng dòng "TI vuông 1000/5". Trong một dòng, thiết
 * bị khớp chắc chắn được lấy trước thiết bị chưa rõ hình dạng.
 */
export function supplyOfPoint(need: NeedLine[], assets: Asset[], devices: Device[]): LineSupply[] {
  const devOf = deviceIndex(devices);
  const pool = [...assets];
  const weight = (n: NeedLine) => (n.ratio_primary != null ? 2 : 0) + (n.shape ? 1 : 0);
  const order = need.map((n, i) => ({ n, i })).sort((a, b) => weight(b.n) - weight(a.n) || a.i - b.i);
  const out: LineSupply[] = need.map(line => ({ line, have: [], missing: line.qty, unsureShape: 0 }));

  for (const { n, i } of order) {
    for (const want of ['yes', 'unsure_shape'] as const) {
      for (let k = 0; k < pool.length && out[i].have.length < n.qty;) {
        if (matchDevice(devOf(pool[k]), n) === want) {
          out[i].have.push(pool[k]);
          if (want === 'unsure_shape') out[i].unsureShape++;
          pool.splice(k, 1);
        } else k++;
      }
    }
    out[i].missing = n.qty - out[i].have.length;
  }
  return out;
}

/* ------------------------------ đơn mua ------------------------------ */

/** Số thiết bị đã nhận theo từng dòng đơn mua. */
export function receivedByLine(devices: Device[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of devices) if (d.purchase_line) m.set(d.purchase_line, (m.get(d.purchase_line) ?? 0) + 1);
  return m;
}

/** Dòng đơn còn CHỜ HÀNG (đơn chưa hủy, chưa nhận đủ) — kèm số còn chờ. */
export function openPurchaseLines(
  purchases: Purchase[], lines: PurchaseLine[], devices: Device[],
): { line: PurchaseLine; pending: number }[] {
  const live = new Set(purchases.filter(p => !p.cancelled).map(p => p.id));
  const got = receivedByLine(devices);
  return lines
    .filter(l => live.has(l.purchase))
    .map(line => ({ line, pending: line.qty - (got.get(line.id) ?? 0) }))
    .filter(x => x.pending > 0);
}

/* ------------------------- trạng thái quy trình ------------------------- */

/**
 *   chua_khai   ① điểm đo dự kiến, chưa khai nhu cầu          → việc Kinh Doanh
 *   thieu       ② còn thiếu, đơn mua chưa phủ                  → việc Vật Tư
 *   cho_hang    ③ phần thiếu đã nằm trong đơn mua chưa về      → Vật Tư theo dõi
 *   du_cho_treo ④ đủ vật tư, công tơ chưa có ngày treo         → việc Vận Hành
 *   da_treo     ⑤ công tơ đã có ngày treo — thoát luồng
 */
export type SupplyState = 'chua_khai' | 'thieu' | 'cho_hang' | 'du_cho_treo' | 'da_treo';

export const SUPPLY_STATE_LABEL: Record<SupplyState, string> = {
  chua_khai: 'Chưa khai nhu cầu',
  thieu: 'Thiếu vật tư',
  cho_hang: 'Chờ hàng về',
  du_cho_treo: 'Đủ – chờ treo',
  da_treo: 'Đã treo',
};

export interface PointSupply {
  state: SupplyState;
  lines: LineSupply[];
  missing: number;
  unsureShape: number;
}

/**
 * Mốc "đã treo" giữ đúng luật `pointStatus.ts` (user chốt 22/08/2026): công tơ
 * còn hoạt động đã có ngày treo. Không xét hóa đơn — luồng này chỉ quan tâm
 * vật tư đã ra hiện trường chưa.
 */
export function isHung(assets: Asset[]): boolean {
  return assets.some(a => a.type === 'CONGTO' && ymd(a.date_on) && !ymd(a.date_off) && a.active !== false);
}

export interface SupplyContext {
  assets: Asset[];
  devices: Device[];
  purchases: Purchase[];
  purchaseLines: PurchaseLine[];
}

export function pointSupply(p: Point, ctx: SupplyContext): PointSupply {
  const mine = allocatedAssets(ctx.assets, p.id);
  const need = cleanNeed(p.need);
  const lines = supplyOfPoint(need, mine, ctx.devices);
  const missing = lines.reduce((s, l) => s + l.missing, 0);
  const unsureShape = lines.reduce((s, l) => s + l.unsureShape, 0);
  const base = { lines, missing, unsureShape };

  if (isHung(mine)) return { state: 'da_treo', ...base };
  if (!need.length) return { state: 'chua_khai', ...base };
  if (missing === 0) return { state: 'du_cho_treo', ...base };

  // Đơn mua có phủ hết phần thiếu không — chỉ tính dòng đơn ghi "cho điểm đo này".
  const open = openPurchaseLines(ctx.purchases, ctx.purchaseLines, ctx.devices)
    .filter(o => o.line.for_point === p.id);
  const covered = lines.every(l => {
    if (l.missing === 0) return true;
    const onOrder = open
      .filter(o => matchDevice({ ...o.line, shape: o.line.shape || '' }, l.line) !== 'no')
      .reduce((s, o) => s + o.pending, 0);
    return onOrder >= l.missing;
  });
  return { state: covered ? 'cho_hang' : 'thieu', ...base };
}

/* ---------------------- phân bổ + mượn (đợt 2) ---------------------- */

const isPlanRow = (a: Asset) => !ymd(a.date_on) && !ymd(a.date_off);

export interface Candidate {
  device: Device;
  match: Exclude<MatchResult, 'no'>;
}

/**
 * Thiết bị TRONG KHO phân bổ được cho một dòng nhu cầu: chưa thanh lý, không
 * đang treo, không có dòng dự kiến ở điểm đo nào, không giữ chỗ cho điểm đo
 * KHÁC. Khớp chắc chắn xếp trước khớp tạm (TI chưa rõ hình dạng).
 * Lấy vật tư đang dự kiến ở điểm đo khác là MƯỢN — xem `borrowCandidates`.
 */
export function allocCandidates(pointId: string, line: NeedLine, ctx: Pick<SupplyContext, 'assets' | 'devices'>): Candidate[] {
  const taken = new Set<string>();
  const takenSerial = new Set<string>();
  for (const a of ctx.assets) {
    if (ymd(a.date_off)) continue;
    if (ymd(a.date_on) || a.point) {
      if (a.device) taken.add(a.device);
      if (a.serial?.trim()) takenSerial.add(a.serial.trim());
    }
  }
  const out: Candidate[] = [];
  for (const d of ctx.devices) {
    if (ymd(d.liquidated_at) || taken.has(d.id) || takenSerial.has(d.serial.trim())) continue;
    if (d.hold_point && d.hold_point !== pointId) continue;
    const m = matchDevice(d, line);
    if (m !== 'no') out.push({ device: d, match: m });
  }
  return out.sort((a, b) => (a.match === b.match ? a.device.serial.localeCompare(b.device.serial) : a.match === 'yes' ? -1 : 1));
}

export interface BorrowCandidate extends Candidate {
  /** Lần lắp dự kiến ở điểm đo cho mượn — sẽ bị gỡ. */
  asset: Asset;
  from: Point;
  /** Điểm đo cho mượn đang ĐỦ, chờ treo — mượn của nó là làm nó lỡ đợt treo. */
  fromReady: boolean;
}

/**
 * Vật tư MƯỢN ĐƯỢC cho điểm đo cần gấp (user chốt 26/10/2026): chỉ vật tư DỰ
 * KIẾN (chưa ngày treo) ở điểm đo CHƯA TREO và KHÔNG GẤP. Không bao giờ lấy
 * vật tư đã treo.
 * Thứ tự gợi ý: điểm đo cho mượn còn thiếu trước (đằng nào cũng chưa treo được),
 * điểm đo đã đủ chờ treo sau; trong đó khớp chắc chắn trước, rồi theo mã.
 */
export function borrowCandidates(
  pointId: string, line: NeedLine, points: Point[], ctx: SupplyContext,
): BorrowCandidate[] {
  const devById = new Map(ctx.devices.map(d => [d.id, d]));
  const devBySerial = new Map(ctx.devices.map(d => [d.serial.trim(), d]));
  const out: BorrowCandidate[] = [];
  for (const q of points) {
    if (q.id === pointId || q.urgent) continue;
    const mine = allocatedAssets(ctx.assets, q.id);
    if (isHung(mine)) continue;
    let fromReady: boolean | undefined;
    for (const a of mine) {
      if (!isPlanRow(a)) continue;
      const d = (a.device && devById.get(a.device)) || devBySerial.get((a.serial ?? '').trim());
      if (!d || ymd(d.liquidated_at)) continue;
      const m = matchDevice(d, line);
      if (m === 'no') continue;
      fromReady ??= pointSupply(q, ctx).state === 'du_cho_treo';
      out.push({ device: d, match: m, asset: a, from: q, fromReady });
    }
  }
  return out.sort((a, b) =>
    Number(a.fromReady) - Number(b.fromReady)
    || (a.match === b.match ? 0 : a.match === 'yes' ? -1 : 1)
    || (a.from.code ?? '').localeCompare(b.from.code ?? '')
    || a.device.serial.localeCompare(b.device.serial));
}

/**
 * Dòng sổ mượn ĐÓNG ĐƯỢC: điểm đo bị mượn nay đã đủ vật tư lại (hoặc đã treo).
 * Không cần thao tác "trả" — bù đủ là xong nợ.
 */
export function borrowsToSettle(borrows: Borrow[], points: Point[], ctx: SupplyContext): Borrow[] {
  const byId = new Map(points.map(p => [p.id, p]));
  const done = new Map<string, boolean>();
  return borrows.filter(b => {
    if (ymd(b.settled_at)) return false;
    const p = byId.get(b.from_point);
    if (!p) return false;
    if (!done.has(p.id)) {
      const s = pointSupply(p, ctx);
      done.set(p.id, s.state === 'da_treo' || s.state === 'du_cho_treo');
    }
    return done.get(p.id)!;
  });
}

/** Điểm đo đang BỊ MƯỢN (còn dòng sổ mượn chưa đóng) → số thiết bị đang nợ. */
export function openBorrowsByPoint(borrows: Borrow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of borrows) if (!ymd(b.settled_at)) m.set(b.from_point, (m.get(b.from_point) ?? 0) + 1);
  return m;
}
