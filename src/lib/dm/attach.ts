/**
 * LUẬT GẮN THIẾT BỊ VÀO ĐIỂM ĐO — module THUẦN, dùng chung cho:
 *   - Kho vật tư → "Gắn vào điểm đo" (`StockEntry.tsx`, luật có từ 13/10/2026)
 *   - Phân bổ vật tư (`SupplyAllocate.tsx`, luồng cấp vật tư đợt 2, 26/10/2026)
 *
 * Tách ra từ `StockEntry.tsx` để hai màn không giữ hai bản luật — lệch nhau là
 * một thiết bị treo hai nơi. Thực thi (ghi PB) ở `attachRun.ts`.
 *
 *   CHẶN: đã thanh lý · đang treo (nơi khác hoặc chính điểm đo này) · đã có
 *         dòng dự kiến ở điểm đo này · TI chọn khác tỷ số nhau · TI×TU ≠ HSN.
 *   CHUYỂN (= MƯỢN): thiết bị đang DỰ KIẾN ở điểm đo khác ⇒ gỡ dòng bên đó
 *         và ghi sổ mượn `dm_borrow`.
 */
import { setMatchesHsn } from './tutiPick';
import type { Asset, Device, Point } from './types';

const ymd = (v?: string | null): string => (v ?? '').slice(0, 10);
const isPlan = (a: Pick<Asset, 'date_on' | 'date_off'>) => !ymd(a.date_on) && !ymd(a.date_off);

/** Lần lắp của một thiết bị — theo `device`, không có thì theo số No (như `buildStock`). */
export function installsOf(d: Device, assets: Asset[]): Asset[] {
  const byId = assets.filter(a => a.device === d.id);
  if (byId.length) return byId;
  const sn = d.serial.trim();
  return assets.filter(a => !a.device && (a.serial ?? '').trim() === sn);
}

export interface AttachMove {
  serial: string;
  device: string;
  /** Lần lắp dự kiến ở điểm đo kia — sẽ bị gỡ. */
  assetId: string;
  fromPoint: string;
  fromCode: string;
}

export interface AttachPlan {
  blocks: string[];
  moves: AttachMove[];
}

export function planAttach(
  picked: Device[], pointId: string,
  data: { assets: Asset[]; points: Point[] },
): AttachPlan {
  const blocks: string[] = [];
  const moves: AttachMove[] = [];
  if (!pointId) return { blocks, moves };
  const codeOf = (id?: string) => data.points.find(p => p.id === id)?.code ?? '(không rõ)';
  const target = data.points.find(p => p.id === pointId);

  for (const dev of picked) {
    const sn = dev.serial;
    const mine = installsOf(dev, data.assets);
    if (ymd(dev.liquidated_at)) { blocks.push(`${sn} đã thanh lý`); continue; }
    const open = mine.find(a => ymd(a.date_on) && !ymd(a.date_off));
    if (open) {
      blocks.push(open.point === pointId
        ? `${sn} đã treo ở chính điểm đo này`
        : `${sn} đang treo ở ${codeOf(open.point)} — khai ngày tháo ở đó trước`);
      continue;
    }
    if (mine.some(a => a.point === pointId && isPlan(a))) {
      blocks.push(`${sn} đã có dòng dự kiến ở điểm đo này — mở điểm đo để khai ngày treo`);
      continue;
    }
    for (const a of mine.filter(a => a.point && a.point !== pointId && isPlan(a))) {
      moves.push({ serial: sn, device: dev.id, assetId: a.id, fromPoint: a.point!, fromCode: codeOf(a.point) });
    }
  }

  // HSN: bộ TI (× TU) gắn vào phải khớp HSN điểm đo — cùng luật form điểm đo.
  const ratioOf2 = (x?: number | null, y?: number | null) => (x && y ? { primary: x, secondary: y } : null);
  const tis = picked.filter(d => d.type === 'TI');
  if (tis.length) {
    const kinds = new Set(tis.map(d => `${d.ratio_primary ?? ''}/${d.ratio_secondary ?? ''}`));
    const hsn = target?.hsn;
    const tuDev = picked.find(d => d.type === 'TU')
      ?? data.assets.find(a => a.point === pointId && a.type === 'TU' && !ymd(a.date_off));
    if (kinds.size > 1) blocks.push(`các TI chọn không cùng tỷ số (${[...kinds].join(' ≠ ')})`);
    else if (!hsn) blocks.push(`điểm đo ${target?.code ?? ''} chưa khai HSN — khai HSN ở form điểm đo trước`);
    else if (!setMatchesHsn(hsn, ratioOf2(tis[0].ratio_primary, tis[0].ratio_secondary),
      tuDev ? ratioOf2(tuDev.ratio_primary, tuDev.ratio_secondary) : null)) {
      blocks.push(`TI ${[...kinds][0]}${tuDev ? ` × TU ${tuDev.ratio_primary}/${tuDev.ratio_secondary}` : ''} `
        + `không khớp HSN ${hsn} của điểm đo`);
    }
  }
  return { blocks, moves };
}
