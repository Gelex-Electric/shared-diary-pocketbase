/**
 * Luật nghiệp vụ điểm đo & vật tư (v2) — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * User chốt 07/08:
 *   R1  Mỗi điểm đo có đúng 1 công tơ đang treo.
 *   R2  Mỗi điểm đo có đúng 1 GP-03 đang treo.
 *   R3  Công tơ trực tiếp (ME-42, DTS27) → cấm treo TI/TU, HSN = 1.
 *   R4  Công tơ gián tiếp (ME-41) → bắt buộc có TI, HSN = tỷ số TU × tỷ số TI.
 *   R5  Một bộ TI (hoặc TU) cùng tỷ số chỉ tính MỘT lần trong phép nhân.
 *   R6  Không có TU → thừa số TU = 1.
 *   R7  Vật tư quá hạn kiểm định không được treo.
 *   R8  HSN không cho gõ tay, luôn suy ra từ vật tư đang treo.
 *
 * PHÂN BIỆT HAI MỨC VI PHẠM — không có phân biệt này thì không lắp được cái
 * đầu tiên: treo công tơ ME-41 lên điểm đo trống đương nhiên là "chưa có TI".
 *   - `sai`   : trạng thái mâu thuẫn, chặn NGAY tại thao tác (2 công tơ, TI
 *               trên công tơ trực tiếp, quá hạn kiểm định...).
 *   - `thieu` : còn lắp dở, cho phép trong lúc làm, nhưng CHẶN khi chuyển điểm
 *               đo sang "đang vận hành".
 *
 * Module thuần, KHÔNG import PocketBase, để chạy được bằng `tsx` khi kiểm thử.
 */
import {
  type V2Asset, type V2AssetType, type V2PointStatus,
  isMeter, isIndirectMeter, isDirectMeter, hasRatio, V2_ASSET_TYPE_LABEL,
} from './schema';

export type ViolationLevel = 'sai' | 'thieu';

export interface Violation {
  rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R7';
  level: ViolationLevel;
  message: string;
}

export interface Check {
  ok: boolean;
  /** Lý do bị chặn — luôn nói được vì sao, không trả về true/false trống. */
  reason?: string;
}

/** Điểm đo chưa vận hành hoặc đã tháo thì không đòi đủ thiết bị. */
const exemptFromMissing = (s: V2PointStatus) => s === 'du_kien' || s === 'dismounted';

const label = (t: string) => V2_ASSET_TYPE_LABEL[t as V2AssetType] ?? t;
const names = (list: V2Asset[]) => list.map(a => a.serial).sort().join(', ');

/** Tỷ số dùng được? TI/TU thiếu tỷ số thì HSN suy ra không đáng tin. */
const validRatio = (a: V2Asset): boolean =>
  typeof a.ratio === 'number' && Number.isFinite(a.ratio) && a.ratio > 0;

export function isOverdue(a: V2Asset, today = new Date()): boolean {
  if (a.type === 'GP03' || a.type === 'KHAC') return false;   // không kiểm định
  if (!a.next_calibration) return false;
  return a.next_calibration.slice(0, 10) < today.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Hệ số nhân
 * ------------------------------------------------------------------ */

export interface HsnResult {
  /** null = chưa suy ra được (chưa có công tơ, hoặc TI thiếu tỷ số). */
  value: number | null;
  explain: string;
}

/**
 * HSN của điểm đo, suy từ vật tư ĐANG TREO (R3/R4/R5/R6).
 * `assets` = danh sách vật tư đang treo tại điểm đo đó.
 */
export function hsnOf(assets: V2Asset[]): HsnResult {
  const meter = assets.find(a => isMeter(a.type));
  if (!meter) return { value: null, explain: 'Chưa treo công tơ — chưa suy ra được hệ số nhân.' };

  if (isDirectMeter(meter.type)) {
    return { value: 1, explain: `Công tơ ${label(meter.type)} đấu trực tiếp — hệ số nhân = 1.` };
  }

  // ME-41: nhân tỷ số TI và TU. Mỗi loại chỉ lấy MỘT tỷ số (R5): bộ 3 TI hạ
  // thế 2500/5 là MỘT lần biến đổi, nhân cả ba sẽ ra con số vô nghĩa.
  const terms: string[] = [];
  let value = 1;
  let seenTi = false;

  for (const t of ['TI', 'TU'] as const) {
    const group = assets.filter(a => a.type === t);
    if (!group.length) continue;
    const ratios = [...new Set(group.filter(validRatio).map(a => a.ratio as number))];
    if (ratios.length !== 1) {
      // 0 = thiếu tỷ số, >1 = lắp lẫn tỷ số. Cả hai đều không được đoán bừa.
      return {
        value: null,
        explain: ratios.length === 0
          ? `${t} đang treo chưa khai tỷ số — chưa suy ra được hệ số nhân.`
          : `${t} đang treo có ${ratios.length} tỷ số khác nhau — kiểm tra lại trước khi tính.`,
      };
    }
    if (t === 'TI') seenTi = true;
    const g = group[0];
    terms.push(`${t} ${g.ratio_primary}/${g.ratio_secondary}${group.length > 1 ? ` (bộ ${group.length} cái)` : ''}`);
    value *= ratios[0];
  }

  if (!seenTi) {
    return { value: null, explain: `Công tơ ${label(meter.type)} đo gián tiếp nhưng chưa treo TI — chưa có hệ số nhân.` };
  }

  // Làm tròn 6 chữ số: tỷ số là phép chia nên tích hay ra đuôi nhị phân
  // (2000/5 × 22000/100 = 88000.00000000001).
  const v = Math.round(value * 1e6) / 1e6;
  return { value: v, explain: `${terms.join(' × ')} = ${v}` };
}

/* ------------------------------------------------------------------ *
 * Soát một điểm đo
 * ------------------------------------------------------------------ */

/**
 * Mọi vi phạm của một điểm đo, xét trên danh sách vật tư đang treo.
 * Dùng chung cho lúc thao tác (xét trạng thái SAU thao tác) và lúc soát lỗi.
 */
export function pointViolations(status: V2PointStatus, assets: V2Asset[]): Violation[] {
  const out: Violation[] = [];
  const meters = assets.filter(a => isMeter(a.type));
  const gp03 = assets.filter(a => a.type === 'GP03');
  const ratioParts = assets.filter(a => hasRatio(a.type));
  const skipMissing = exemptFromMissing(status);

  // R1 — đúng 1 công tơ
  if (meters.length > 1) {
    out.push({ rule: 'R1', level: 'sai', message: `Có ${meters.length} công tơ cùng lúc (${names(meters)}) — mỗi điểm đo chỉ 1` });
  } else if (meters.length === 0 && !skipMissing) {
    out.push({ rule: 'R1', level: 'thieu', message: 'Chưa treo công tơ' });
  }

  // R2 — đúng 1 GP-03
  if (gp03.length > 1) {
    out.push({ rule: 'R2', level: 'sai', message: `Có ${gp03.length} GP-03 cùng lúc (${names(gp03)}) — mỗi điểm đo chỉ 1` });
  } else if (gp03.length === 0 && !skipMissing) {
    out.push({ rule: 'R2', level: 'thieu', message: 'Chưa treo GP-03' });
  }

  const meter = meters[0];
  if (meter) {
    // R3 — công tơ trực tiếp thì không có TI/TU
    if (isDirectMeter(meter.type) && ratioParts.length) {
      out.push({
        rule: 'R3', level: 'sai',
        message: `Công tơ ${label(meter.type)} đấu trực tiếp nhưng đang treo ${names(ratioParts)} — hệ số nhân phải bằng 1`,
      });
    }
    // R4 — công tơ gián tiếp bắt buộc có TI
    if (isIndirectMeter(meter.type)) {
      const ti = assets.filter(a => a.type === 'TI');
      if (!ti.length && !skipMissing) {
        out.push({ rule: 'R4', level: 'thieu', message: `Công tơ ${label(meter.type)} đo gián tiếp nhưng chưa treo TI` });
      }
      const noRatio = ti.filter(a => !validRatio(a));
      if (noRatio.length) {
        out.push({ rule: 'R4', level: 'sai', message: `TI ${names(noRatio)} chưa khai tỷ số — không tính được hệ số nhân` });
      }
      // R5 — lẫn tỷ số trong cùng một bộ
      for (const t of ['TI', 'TU'] as const) {
        const rs = [...new Set(assets.filter(a => a.type === t && validRatio(a)).map(a => a.ratio as number))];
        if (rs.length > 1) {
          out.push({ rule: 'R5', level: 'sai', message: `${t} cùng điểm đo có ${rs.length} tỷ số khác nhau (${rs.join(', ')})` });
        }
      }
    }
  }

  // R7 — quá hạn kiểm định mà vẫn treo
  for (const a of assets) {
    if (isOverdue(a)) {
      out.push({ rule: 'R7', level: 'sai', message: `${a.serial} (${label(a.type)}) quá hạn kiểm định ${a.next_calibration?.slice(0, 10)}` });
    }
  }

  return out;
}

/** Điểm đo có mâu thuẫn phải sửa ngay không? (dùng để KHOÁ GHI) */
export function isLocked(status: V2PointStatus, assets: V2Asset[]): boolean {
  return pointViolations(status, assets).some(v => v.level === 'sai');
}

/* ------------------------------------------------------------------ *
 * Thao tác treo / tháo / đổi trạng thái
 * ------------------------------------------------------------------ */

/**
 * Treo `asset` lên điểm đo đang có `current`.
 * Xét trạng thái SAU thao tác rồi mới quyết định — cách này bắt được cả ca
 * chọn nhiều vật tư một lúc (truyền chúng vào `current` cùng nhau).
 */
export function canHang(
  asset: V2Asset, status: V2PointStatus, current: V2Asset[],
): Check {
  if (asset.current_status !== 'kho' && asset.current_status !== 'dat') {
    return { ok: false, reason: `${asset.serial} không nằm trong kho (đang "${asset.current_status}") — chỉ vật tư trong kho mới treo được` };
  }
  if (status === 'dismounted') {
    return { ok: false, reason: 'Điểm đo đã tháo, không nhận vật tư' };
  }
  if (isOverdue(asset)) {
    return { ok: false, reason: `${asset.serial} quá hạn kiểm định ${asset.next_calibration?.slice(0, 10)}` };
  }
  if (current.some(a => a.id === asset.id)) {
    return { ok: false, reason: `${asset.serial} đã treo ở điểm đo này rồi` };
  }

  const after = [...current, asset];
  const blocking = pointViolations(status, after).filter(v => v.level === 'sai');
  if (blocking.length) return { ok: false, reason: blocking[0].message };
  return { ok: true };
}

/** Tháo vật tư khỏi điểm đo. Tháo luôn được — gỡ bớt không tạo mâu thuẫn mới. */
export function canRemove(asset: V2Asset, current: V2Asset[]): Check {
  if (!current.some(a => a.id === asset.id)) {
    return { ok: false, reason: `${asset.serial} không đang treo ở điểm đo này` };
  }
  return { ok: true };
}

/**
 * Chuyển điểm đo sang "đang vận hành" — đây là chỗ luật siết chặt nhất: phải
 * hết sạch vi phạm, kể cả mức `thieu`.
 */
export function canActivate(assets: V2Asset[]): Check {
  const vs = pointViolations('active', assets);
  if (vs.length) return { ok: false, reason: vs.map(v => v.message).join('; ') };
  if (hsnOf(assets).value == null) return { ok: false, reason: 'Chưa suy ra được hệ số nhân' };
  return { ok: true };
}
