/**
 * Kiểm tra ràng buộc danh mục ngay trên trình duyệt (task 9, phần giao diện).
 *
 * Bản song sinh của `scripts/validate_catalog.py`. Hai bản PHẢI cho cùng kết
 * quả — sửa luật ở đây thì sửa cả bên kia.
 *
 * Vì sao có hai bản: script dùng để soát định kỳ / trước khi bàn giao, còn bản
 * này chạy trên dữ liệu đã nạp sẵn nên thấy ngay lúc đang nhập liệu, không phải
 * mở cửa sổ dòng lệnh.
 *
 * Không import PocketBase để kiểm thử được bằng tsx.
 */
import type { CatalogData } from './catalog';
import { isMeter, needsCalibration } from './catalog';
import { hsnOfPoint, hsnMismatch } from './hsn';

export type Level = 'loi' | 'canh_bao';

export interface Finding {
  check: number;
  level: Level;
  title: string;
  detail: string;
  /** id bản ghi liên quan — để sau này bấm vào là nhảy tới đúng dòng. */
  refId?: string;
  refKind?: 'point' | 'asset';
}

export interface ValidateResult {
  errors: Finding[];
  warnings: Finding[];
  /** id điểm đo / vật tư có vấn đề — để đánh dấu ngay trên bảng. */
  flagged: Set<string>;
}

export function validateCatalog(d: CatalogData): ValidateResult {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  const zoneCode = (id: string) => d.zones.find(z => z.id === id)?.code ?? '?';
  const pname = (p: { line_name?: string; zone: string }) =>
    `${p.line_name || '(chưa đặt tên)'} [${zoneCode(p.zone)}]`;

  const cur = d.installs.filter(i => i.is_current);
  const byPoint = new Map<string, typeof cur>();
  const byAsset = new Map<string, typeof cur>();
  for (const i of cur) {
    if (!byPoint.has(i.point)) byPoint.set(i.point, []);
    byPoint.get(i.point)!.push(i);
    if (!byAsset.has(i.asset)) byAsset.set(i.asset, []);
    byAsset.get(i.asset)!.push(i);
  }
  const assetById = new Map(d.assets.map(a => [a.id, a]));
  const typesAt = (pid: string) =>
    (byPoint.get(pid) ?? []).map(i => assetById.get(i.asset)?.type).filter(Boolean) as string[];

  for (const p of d.points) {
    // 1. Điểm đo có ≥2 công tơ KHÁC NHAU (đếm bản ghi sẽ báo nhầm bản ghi trùng)
    const meters = new Map<string, string>();
    for (const i of byPoint.get(p.id) ?? []) {
      const a = assetById.get(i.asset);
      if (a && isMeter(a.type)) meters.set(a.id, a.serial);
    }
    if (meters.size >= 2) {
      add({ check: 1, level: 'loi', refId: p.id, refKind: 'point',
        title: `Điểm đo có ${meters.size} công tơ cùng lúc`,
        detail: `${pname(p)}: ${[...meters.values()].sort().join(', ')}` });
    }

    // 2. TI (hoặc TU) cùng điểm đo khác tỷ số nhau
    const h = hsnOfPoint(d, p.id);
    if (h.conflicts.length) {
      add({ check: 2, level: 'loi', refId: p.id, refKind: 'point',
        title: `${h.conflicts.join(', ')} cùng điểm đo khác tỷ số nhau`,
        detail: pname(p) });
    }

    // 3. HSN hóa đơn bất thường, và lệch với HSN suy ra
    if (p.point_status === 'active') {
      if (!p.hsn_invoice) {
        add({ check: 3, level: 'loi', refId: p.id, refKind: 'point',
          title: 'HSN hóa đơn bằng 0 / để trống', detail: pname(p) });
      } else if (p.hsn_invoice > 100000) {
        add({ check: 3, level: 'loi', refId: p.id, refKind: 'point',
          title: 'HSN hóa đơn bất thường (có thể bị ghi nhầm số hiệu)',
          detail: `${pname(p)}: ${p.hsn_invoice}` });
      }
    }
    if (hsnMismatch(h.value, p.hsn_invoice) === true) {
      add({ check: 3, level: 'loi', refId: p.id, refKind: 'point',
        title: 'HSN suy ra lệch HSN hóa đơn',
        detail: `${pname(p)}: suy ra ${h.value}, hóa đơn ${p.hsn_invoice}` });
    }

    // 5. Thiếu công tơ / GP-03. Điểm đo đặt trước hoặc đã tháo thì không đòi.
    if (p.point_status !== 'du_kien' && p.point_status !== 'dismounted') {
      const ts = typesAt(p.id);
      const thieu: string[] = [];
      if (!ts.some(isMeter)) thieu.push('công tơ');
      if (!ts.includes('GP03')) thieu.push('GP-03');
      if (thieu.length) {
        add({ check: 5, level: 'canh_bao', refId: p.id, refKind: 'point',
          title: `Điểm đo thiếu ${thieu.join(' và ')}`, detail: pname(p) });
      }

      // 7. Công tơ 3 pha thường đi với 2 hoặc 3 TI
      if (ts.some(isMeter)) {
        const nTi = ts.filter(t => t === 'TI').length;
        if (nTi !== 0 && nTi !== 2 && nTi !== 3) {
          add({ check: 7, level: 'canh_bao', refId: p.id, refKind: 'point',
            title: `Điểm đo có ${nTi} TI (thường là 2 hoặc 3)`, detail: pname(p) });
        }
      }
    }
  }

  // 4. Một vật tư treo ở nhiều nơi / bản ghi treo trùng
  for (const [aid, insts] of byAsset) {
    if (insts.length < 2) continue;
    const a = assetById.get(aid);
    const pids = new Set(insts.map(i => i.point));
    if (pids.size === 1) {
      add({ check: 4, level: 'loi', refId: aid, refKind: 'asset',
        title: `Bản ghi treo bị trùng (${insts.length} bản ghi cùng 1 điểm đo)`,
        detail: a?.serial ?? aid });
    } else {
      add({ check: 4, level: 'loi', refId: aid, refKind: 'asset',
        title: `Vật tư treo ở ${pids.size} điểm đo khác nhau`,
        detail: a?.serial ?? aid });
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const a of d.assets) {
    if (!needsCalibration(a.type)) continue;

    // 8. Quá hạn kiểm định nhưng vẫn đang treo
    const nc = (a.next_calibration ?? '').slice(0, 10);
    if (nc && nc < today && a.current_status === 'dang_treo') {
      add({ check: 8, level: 'canh_bao', refId: a.id, refKind: 'asset',
        title: 'Quá hạn kiểm định nhưng vẫn treo',
        detail: `${a.serial} (${a.type}): hạn ${nc}` });
    }

    // 10. Thiếu hạn kiểm định
    if (!a.next_calibration) {
      add({ check: 10, level: 'canh_bao', refId: a.id, refKind: 'asset',
        title: 'Thiếu hạn kiểm định',
        detail: `${a.serial} (${a.type}): năm SX ${a.manufacture_year ?? 'không rõ'}` });
    }
  }

  const errors = out.filter(f => f.level === 'loi');
  const warnings = out.filter(f => f.level === 'canh_bao');
  return { errors, warnings, flagged: new Set(out.map(f => f.refId).filter(Boolean) as string[]) };
}

/** Gộp theo mã kiểm tra để hiện thành từng nhóm thay vì một danh sách dài. */
export function groupByCheck(list: Finding[]): Array<{ check: number; title: string; items: Finding[] }> {
  const m = new Map<number, Finding[]>();
  for (const f of list) {
    if (!m.has(f.check)) m.set(f.check, []);
    m.get(f.check)!.push(f);
  }
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([check, items]) => ({ check, title: items[0].title, items }));
}
