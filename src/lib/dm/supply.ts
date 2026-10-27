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
  Asset, AssetType, Borrow, Connection, Device, NeedLine, Point, TiShape,
} from './types';
import { DEFAULT_TI_SHAPE } from './types';

const ymd = (v?: string | null): string => (v ?? '').slice(0, 10);

/** Loại có tỷ số — TI, TU. Loại khác bỏ qua tỷ số khi khớp. */
export const HAS_RATIO: AssetType[] = ['TI', 'TU'];

/* ------------------------------ quy cách ------------------------------ */

type Spec = Pick<NeedLine, 'type' | 'ratio_primary' | 'ratio_secondary' | 'shape' | 'meter_kind'>;
type DeviceSpec = Pick<Device, 'type' | 'ratio_primary' | 'ratio_secondary' | 'shape' | 'meter_kind'>;

/**
 * "KIỂU" của quy cách: hình dạng với TI, loại trực tiếp/gián tiếp với công tơ,
 * loại khác không có. Trống = không đòi / chưa rõ.
 */
export const variantOf = (s: Pick<Spec, 'type' | 'shape' | 'meter_kind'>): string =>
  s.type === 'TI' ? (s.shape || '') : s.type === 'CONGTO' ? (s.meter_kind || '') : '';

/** Khoá gom theo QUY CÁCH: loại + tỷ số (TI/TU) + kiểu (hình dạng TI / loại công tơ). */
export function specKey(s: Spec): string {
  const ratio = HAS_RATIO.includes(s.type) ? formatRatio(s.ratio_primary, s.ratio_secondary) : '';
  return `${s.type}|${ratio}|${variantOf(s)}`;
}

export type MatchResult = 'yes' | 'unsure_shape' | 'no';

/**
 * Thiết bị có khớp dòng nhu cầu không.
 * - Khác loại / khác tỷ số ⇒ không.
 * - Nhu cầu chưa ghi tỷ số ⇒ tỷ số nào cũng được.
 * - KIỂU (hình dạng TI / loại công tơ): nhu cầu có ghi mà thiết bị CHƯA RÕ ⇒
 *   `unsure_shape` — VẪN tính là khớp (dữ liệu cũ chưa khai; chặn thì không
 *   phân bổ được gì), nhưng hiện cảnh báo. Khác kiểu rõ ràng ⇒ không.
 */
export function matchDevice(d: DeviceSpec, n: Spec): MatchResult {
  if (d.type !== n.type) return 'no';
  if (HAS_RATIO.includes(n.type) && n.ratio_primary != null) {
    if (d.ratio_primary !== n.ratio_primary) return 'no';
    if (n.ratio_secondary != null && d.ratio_secondary !== n.ratio_secondary) return 'no';
  }
  const want = variantOf(n);
  if (want) {
    const have = variantOf({ ...d, shape: d.shape ?? '', meter_kind: d.meter_kind ?? '' });
    if (!have) return 'unsure_shape';
    if (have !== want) return 'no';
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
 * TI điền sẵn hình dạng mặc định (tròn — vuông là trường hợp đặc biệt, sửa tay).
 * Trung áp KHÔNG tự thêm TU — số TU (2 hay 3) tuỳ sơ đồ, người khai tự thêm.
 */
export function defaultNeed(connection: Connection, hsn?: number | null, mv = false): NeedLine[] {
  const base: NeedLine[] = [
    // Công tơ theo kiểu đấu nối: điểm đo không TI dùng công tơ TRỰC TIẾP.
    { type: 'CONGTO', meter_kind: connection, qty: 1 },
    { type: 'GP03', qty: 1 },
    { type: 'SIM', qty: 1 },
  ];
  if (connection !== 'gian_tiep') return base;
  const ratio = mv ? null : suggestTiRatio(hsn);
  return [{ type: 'TI', qty: TI_PER_SET, shape: DEFAULT_TI_SHAPE, ...(ratio ?? {}) }, ...base];
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
      if (n.type === 'CONGTO' && n.meter_kind) out.meter_kind = n.meter_kind;
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
  /** Trong `have`, bao nhiêu thiết bị chưa rõ kiểu — TI chưa rõ hình dạng / công tơ chưa rõ loại (khớp tạm). */
  unsureShape: number;
}

/** Lần lắp còn thuộc điểm đo: chưa ngày tháo (dự kiến hoặc đang treo). */
export const allocatedAssets = (assets: Asset[], pointId: string): Asset[] =>
  assets.filter(a => a.point === pointId && !ymd(a.date_off));

/** Thiết bị của một lần lắp — theo `device`, không có thì theo số No. */
function deviceIndex(devices: Device[]) {
  const byId = new Map(devices.map(d => [d.id, d]));
  const bySerial = new Map(devices.map(d => [d.serial.trim(), d]));
  return (a: Asset): DeviceSpec =>
    (a.device && byId.get(a.device)) || bySerial.get((a.serial ?? '').trim())
      // Lần lắp chưa nối thiết bị: dùng chính thông tin chép trên dòng.
      || { type: a.type, ratio_primary: a.ratio_primary, ratio_secondary: a.ratio_secondary, shape: '', meter_kind: '' };
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
  const weight = (n: NeedLine) => (n.ratio_primary != null ? 2 : 0) + (variantOf(n) ? 1 : 0);
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

/* ------------------------- trạng thái quy trình ------------------------- */

/**
 * ĐIỂM ĐO HAI PHẦN (user chốt 27/10/2026, plan `2026-10-27-diem-do-hai-phan-nhu-cau-treo-thao.md`):
 *   - NHU CẦU   = `need` (quy cách) + lần lắp CHƯA ngày treo (số No Vật Tư đã gắn)
 *   - TREO THÁO = lần lắp CÓ ngày treo — thứ thật sự ở hiện trường
 * Đáp ứng nhu cầu tính ĐANG TREO trước, rồi mới tới nhu cầu chưa treo.
 *
 *   chua_khai   chưa khai nhu cầu, chưa từng treo             → việc Kinh Doanh
 *   thieu       còn thiếu, đơn mua chưa phủ                   → việc Vật Tư
 *   cho_treo    đủ quy cách nhưng còn dòng chưa treo          → việc Kinh Doanh + Vận Hành
 *   du          đang treo đáp ứng đủ nhu cầu                  → xong
 *   ngoai_luong đã từng treo và KHÔNG có nhu cầu (điểm đo cũ) → không xét
 * Điểm đo đã treo VẪN trong luồng nếu có nhu cầu mà treo thực tế chưa đủ ⇒ treo bổ sung.
 */
export type SupplyState = 'chua_khai' | 'thieu' | 'cho_treo' | 'du' | 'ngoai_luong';

export const SUPPLY_STATE_LABEL: Record<SupplyState, string> = {
  chua_khai: 'Chưa khai nhu cầu',
  thieu: 'Thiếu vật tư',
  cho_treo: 'Chờ treo',
  du: 'Đã treo đủ',
  ngoai_luong: 'Điểm đo cũ',
};

export interface PointSupply {
  state: SupplyState;
  lines: LineSupply[];
  missing: number;
  unsureShape: number;
  /** Đã có công tơ treo thực tế — để nói "treo bổ sung" thay vì "treo mới". */
  hung: boolean;
}

/**
 * Mốc "đã treo" giữ đúng luật `pointStatus.ts` (user chốt 22/08/2026): công tơ
 * còn hoạt động đã có ngày treo. Không xét hóa đơn — luồng này chỉ quan tâm
 * vật tư đã ra hiện trường chưa.
 */
export function isHung(assets: Asset[]): boolean {
  return assets.some(a => a.type === 'CONGTO' && ymd(a.date_on) && !ymd(a.date_off) && a.active !== false);
}

/** Điểm đo đã TỪNG có công tơ treo (kể cả đã tháo) — không còn là điểm đo mới. */
export function everHung(assets: Asset[], pointId: string): boolean {
  return assets.some(a => a.point === pointId && a.type === 'CONGTO' && ymd(a.date_on));
}

export interface SupplyContext {
  assets: Asset[];
  devices: Device[];
}

const isPlanRow = (a: Asset) => !ymd(a.date_on) && !ymd(a.date_off);
const isLiveRow = (a: Asset) => !!ymd(a.date_on) && !ymd(a.date_off);

/** Lần lắp còn hiệu lực của điểm đo, ĐANG TREO xếp trước NHU CẦU CHƯA TREO. */
export const liveFirst = (assets: Asset[], pointId: string): Asset[] => {
  const mine = allocatedAssets(assets, pointId);
  return [...mine.filter(isLiveRow), ...mine.filter(isPlanRow)];
};

export function pointSupply(p: Point, ctx: SupplyContext): PointSupply {
  const mine = liveFirst(ctx.assets, p.id);
  const need = cleanNeed(p.need);
  const lines = supplyOfPoint(need, mine, ctx.devices);
  const missing = lines.reduce((s, l) => s + l.missing, 0);
  const unsureShape = lines.reduce((s, l) => s + l.unsureShape, 0);
  const hung = isHung(mine);
  const base = { lines, missing, unsureShape, hung };

  if (!need.length) return { state: everHung(ctx.assets, p.id) ? 'ngoai_luong' : 'chua_khai', ...base };
  if (missing === 0) {
    return { state: lines.some(l => l.have.some(isPlanRow)) ? 'cho_treo' : 'du', ...base };
  }
  // Tính năng đặt mua đã gỡ (user chốt 27/10/2026) ⇒ còn thiếu là "thiếu", không còn "chờ hàng về".
  return { state: 'thieu', ...base };
}

/* ------------------- đối chiếu nhu cầu ↔ treo thực tế ------------------- */

export interface ReconcileResult {
  /** Dòng nhu cầu CHƯA TREO đã thừa (treo thực tế đã đủ quy cách đó) ⇒ gỡ, thiết bị về kho. */
  release: Asset[];
  /** Quy cách còn thiếu sau khi tính cả treo thực tế lẫn nhu cầu chưa treo ⇒ đề xuất treo bổ sung. */
  shortages: LineSupply[];
  /** Vật tư đang treo không thuộc dòng nhu cầu nào — chỉ ghi chú. */
  extraHung: Asset[];
}

/**
 * Chạy sau MỖI lần ghi treo tháo (user chốt 27/10/2026, xử lý TỰ ĐỘNG).
 * - Đáp ứng nhu cầu bằng vật tư ĐANG TREO trước, rồi mới tới dòng chưa treo.
 * - Dòng chưa treo không còn được dùng mà CÓ khớp một quy cách cần ⇒ thừa ⇒ gỡ
 *   (vd nhu cầu gắn TI A, hiện trường treo TI B cùng quy cách ⇒ A về kho).
 *   Dòng chưa treo không khớp quy cách nào thì giữ nguyên — đó là Vật Tư gắn thêm,
 *   không phải do treo khác.
 * - KHÔNG BAO GIỜ đụng dòng đã có ngày treo.
 * Điểm đo chưa khai nhu cầu ⇒ không làm gì.
 */
export function reconcile(p: Point, assets: Asset[], devices: Device[]): ReconcileResult {
  const need = cleanNeed(p.need);
  const out: ReconcileResult = { release: [], shortages: [], extraHung: [] };
  if (!need.length) return out;
  const mine = liveFirst(assets, p.id);
  const lines = supplyOfPoint(need, mine, devices);
  const used = new Set(lines.flatMap(l => l.have.map(a => a.id)));
  const devOf = deviceIndex(devices);
  for (const a of mine) {
    if (used.has(a.id)) continue;
    if (isLiveRow(a)) out.extraHung.push(a);
    else if (need.some(n => matchDevice(devOf(a), n) !== 'no')) out.release.push(a);
  }
  out.shortages = lines.filter(l => l.missing > 0);
  return out;
}

/* ---------------------- phân bổ + mượn (đợt 2) ---------------------- */

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
 * Vật tư MƯỢN ĐƯỢC: chỉ dòng NHU CẦU CHƯA TREO của điểm đo khác. Không bao giờ lấy
 * vật tư đã treo. Từ 27/10/2026 bỏ "Cần gấp" — điểm đo nào cũng mượn được.
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
    if (q.id === pointId) continue;
    const mine = allocatedAssets(ctx.assets, q.id);
    let fromReady: boolean | undefined;
    for (const a of mine) {
      if (!isPlanRow(a)) continue;
      const d = (a.device && devById.get(a.device)) || devBySerial.get((a.serial ?? '').trim());
      if (!d || ymd(d.liquidated_at)) continue;
      const m = matchDevice(d, line);
      if (m === 'no') continue;
      fromReady ??= pointSupply(q, ctx).state === 'cho_treo';
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
      done.set(p.id, s.state === 'du' || s.state === 'cho_treo' || s.state === 'ngoai_luong');
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

/* ------------------------------ thiết bị rảnh ------------------------------ */

/** Thiết bị RẢNH thật sự: chưa thanh lý, không treo, không dự kiến ở đâu, không giữ chỗ cho ai. */
export function spareDevices(ctx: Pick<SupplyContext, 'assets' | 'devices'>): Device[] {
  const taken = new Set<string>();
  const takenSerial = new Set<string>();
  for (const a of ctx.assets) {
    if (ymd(a.date_off)) continue;
    if (ymd(a.date_on) || a.point) {
      if (a.device) taken.add(a.device);
      if (a.serial?.trim()) takenSerial.add(a.serial.trim());
    }
  }
  return ctx.devices.filter(d => !ymd(d.liquidated_at) && !d.hold_point
    && !taken.has(d.id) && !takenSerial.has(d.serial.trim()));
}

/* -------------------------- việc cần làm (đợt 4) -------------------------- */

export interface SupplyTasks {
  /** Kinh Doanh: điểm đo mới chưa khai nhu cầu. */
  chuaKhai: Point[];
  /** Vật Tư: điểm đo còn thiếu (kể cả đã treo cần bổ sung) — gắn vật tư dự kiến. */
  thieu: Point[];
  /** Kinh Doanh + Vận Hành: điểm đo đủ quy cách, còn dòng chưa treo. */
  choTreo: Point[];
  /** TI còn dùng được chưa khai hình dạng — chỉ để nhắc, KHÔNG đếm vào badge. */
  tiNoShape: number;
}

/**
 * Việc của cả ba nhóm, tính một lượt từ dữ liệu — không ai giao tay (user chốt
 * 26/10/2026). `inScope` lọc điểm đo theo KCN của người xem (Vận Hành).
 * `today` giữ lại cho chữ ký cũ (trước dùng cho đơn mua trễ — đặt mua đã gỡ 27/10/2026).
 */
export function supplyTasks(
  points: Point[], ctx: SupplyContext, _today: string, inScope: (p: Point) => boolean = () => true,
): SupplyTasks {
  const t: SupplyTasks = { chuaKhai: [], thieu: [], choTreo: [], tiNoShape: 0 };
  for (const p of points) {
    if (!inScope(p)) continue;
    const st = pointSupply(p, ctx).state;
    if (st === 'chua_khai') t.chuaKhai.push(p);
    else if (st === 'thieu') t.thieu.push(p);
    else if (st === 'cho_treo') t.choTreo.push(p);
  }
  const byCode = (a: Point, b: Point) => (a.code ?? '').localeCompare(b.code ?? '');
  for (const k of ['chuaKhai', 'thieu', 'choTreo'] as const) t[k].sort(byCode);
  t.tiNoShape = ctx.devices.filter(d => d.type === 'TI' && !d.shape && !ymd(d.liquidated_at)).length;
  return t;
}

/**
 * Số trên badge "Việc cần làm" của từng nhóm (phân việc user chốt lại 27/10/2026):
 * KD = chưa khai nhu cầu + chờ treo · VT = thiếu (gắn dự kiến) · VH = chờ treo.
 */
export function taskCount(t: SupplyTasks, group: 'van_hanh' | 'kinh_doanh' | 'vat_tu'): number {
  if (group === 'kinh_doanh') return t.chuaKhai.length + t.choTreo.length;
  if (group === 'vat_tu') return t.thieu.length;
  return t.choTreo.length;
}
