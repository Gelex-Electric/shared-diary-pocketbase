/**
 * Chọn vật tư từ KHO cho điểm đo theo HSN — module THUẦN, không mạng, không JSX.
 *
 * Luật chốt 28/09/2026 (plan `2026-09-28-diem-do-chon-vat-tu-tu-kho-theo-hsn`):
 * - Vật tư phải khai trong Kho TRƯỚC; form điểm đo chỉ CHỌN, không tạo thiết bị.
 * - HSN nhập tay ở điểm đo là chuẩn; bộ TI (× TU) chọn vào phải có tích tỷ số
 *   đúng bằng HSN, lệch thì không cho lưu.
 */
import { formatRatio, ratioOf, type RatioInput } from './hsn';
import { TI_PER_SET } from './pointStatus';
import type { Asset, AssetType, Device } from './types';

const ymd = (v?: string): string => (v ?? '').slice(0, 10);

/** So HSN có dung sai — tỷ số chia ra số lẻ (vd 22000/110) dễ dính rác dấu phẩy động. */
const sameHsn = (a: number, b: number) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

/** Chuỗi tỷ số của thiết bị, `''` khi thiết bị chưa khai tỷ số. */
export const deviceRatio = (d: Pick<Device, 'ratio_primary' | 'ratio_secondary'>): string =>
  formatRatio(d.ratio_primary, d.ratio_secondary);

export interface FreeFilter {
  type?: AssetType;
  /** Điểm đo đang mở form — lần lắp của chính nó không tính là "bận". */
  pointId?: string | null;
  /** Số No đã nằm ở dòng khác trong form, không cho chọn lần hai. */
  exclude?: Iterable<string>;
}

/**
 * Thiết bị CHỌN ĐƯỢC cho điểm đo: chưa thanh lý, không đang treo ở điểm đo
 * khác. Thiết bị đang GIỮ CHỖ cho điểm khác vẫn chọn được — form đã có luồng
 * đổi chỗ/chuyển chỗ lo phần đó và nói trước khi lưu.
 *
 * Lần lắp nối về thiết bị theo `device` nếu có, không thì theo `serial` (giai
 * đoạn chuyển tiếp, giống `buildStock`).
 */
export function freeDevices(devices: Device[], assets: Asset[], f: FreeFilter = {}): Device[] {
  const busyIds = new Set<string>();
  const busySerials = new Set<string>();
  for (const a of assets) {
    if (!ymd(a.date_on) || ymd(a.date_off)) continue;
    if (f.pointId && a.point === f.pointId) continue;
    if (a.device) busyIds.add(a.device);
    if (a.serial?.trim()) busySerials.add(a.serial.trim());
  }
  const skip = new Set([...(f.exclude ?? [])].map(s => s.trim()).filter(Boolean));
  return devices.filter(d => {
    const sn = d.serial.trim();
    if (!sn || skip.has(sn)) return false;
    if (f.type && d.type !== f.type) return false;
    if (ymd(d.liquidated_at)) return false;
    return !busyIds.has(d.id) && !busySerials.has(sn);
  });
}

export interface SetOption {
  /** Tỷ số TI, vd `1000/5`. */
  ti: string;
  /** Tỷ số TU; không có = điểm đo hạ áp, phần TU bằng 1. */
  tu?: string;
  /** Số TI rảnh đúng tỷ số này (luôn ≥ `TI_PER_SET`). */
  tiFree: number;
  /** Số TU rảnh đúng tỷ số này; 0 khi `tu` trống. */
  tuFree: number;
}

/** Gom thiết bị theo tỷ số → số lượng, bỏ thiết bị chưa khai tỷ số. */
function countByRatio(list: Device[]): Map<string, { ratio: number; n: number }> {
  const m = new Map<string, { ratio: number; n: number }>();
  for (const d of list) {
    const r = ratioOf({ primary: d.ratio_primary, secondary: d.ratio_secondary });
    if (r == null || r <= 0) continue;
    const key = deviceRatio(d);
    const cur = m.get(key);
    if (cur) cur.n++; else m.set(key, { ratio: r, n: 1 });
  }
  return m;
}

/**
 * Các bộ TI (× TU) trong kho có tích tỷ số = HSN.
 *
 * Chỉ nêu tổ hợp đủ `TI_PER_SET` TI rảnh — thiếu TI thì không lắp được bộ nào.
 * TU không có luật số lượng cố định (2 hay 3 tùy sơ đồ đấu) nên chỉ báo số rảnh.
 * Xếp: bộ chỉ TI trước (hạ áp, phổ biến), rồi theo số TI rảnh giảm dần.
 */
export function suggestSets(hsn: number, free: Device[]): SetOption[] {
  if (!Number.isFinite(hsn) || hsn <= 1) return [];
  const tis = countByRatio(free.filter(d => d.type === 'TI'));
  const tus = countByRatio(free.filter(d => d.type === 'TU'));
  const out: SetOption[] = [];
  for (const [ti, t] of tis) {
    if (t.n < TI_PER_SET) continue;
    if (sameHsn(t.ratio, hsn)) out.push({ ti, tiFree: t.n, tuFree: 0 });
    for (const [tu, u] of tus) {
      if (sameHsn(t.ratio * u.ratio, hsn)) out.push({ ti, tu, tiFree: t.n, tuFree: u.n });
    }
  }
  return out.sort((a, b) => Number(!!a.tu) - Number(!!b.tu) || b.tiFree - a.tiFree
    || a.ti.localeCompare(b.ti));
}

/**
 * Bộ TI/TU có khớp HSN nhập tay không.
 * - HSN = 1 ⇒ phải KHÔNG có TI (đo thẳng).
 * - HSN > 1 ⇒ phải có TI; TU trống coi như 1.
 * Tỷ số khai thiếu/hỏng ⇒ không khớp.
 */
export function setMatchesHsn(hsn: number, ti?: RatioInput | null, tu?: RatioInput | null): boolean {
  if (!Number.isFinite(hsn) || hsn <= 0) return false;
  const hasTi = !!ti && (ti.primary != null || ti.secondary != null);
  if (hsn === 1) return !hasTi;
  if (!hasTi) return false;
  const tiR = ratioOf(ti!);
  if (tiR == null) return false;
  const hasTu = !!tu && (tu.primary != null || tu.secondary != null);
  const tuR = hasTu ? ratioOf(tu!) : 1;
  if (tuR == null) return false;
  return sameHsn(tiR * tuR, hsn);
}

/** Đọc ô HSN người dùng gõ: số dương hữu hạn, chấp nhận dấu phẩy thập phân; sai ⇒ `null`. */
export function parseHsnInput(text: string): number | null {
  const s = (text ?? '').trim().replace(',', '.');
  // `Number` chứ không `parseFloat`: "12abc" phải là sai, không lặng lẽ thành 12.
  // Kiểm chuỗi rỗng trước vì `Number('')` bằng 0.
  const v = s ? Number(s) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
}
