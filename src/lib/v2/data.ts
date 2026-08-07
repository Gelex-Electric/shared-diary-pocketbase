/**
 * Nạp dữ liệu cho module v2 và ghép sẵn các thứ màn hình cần.
 *
 * Hai nguồn:
 *   - `pb`   : collection `v2_*` trên PocketBase production (khi đã tạo).
 *   - `demo` : dữ liệu mẫu trong `demo.ts`, để xem thử giao diện khi chưa tạo
 *              collection. Màn hình phải hiện băng cảnh báo khi ở chế độ này.
 *
 * Không tự động ghi bất cứ thứ gì — đợt này mới là xem.
 */
import { pbv2, isAbort, isAuthed } from './pb';
import { V2_COLLECTIONS, type V2Asset, type V2Install, type V2Point } from './schema';
import { DEMO_ASSETS, DEMO_INSTALLS, DEMO_POINTS } from './demo';
import { hsnOf, pointViolations, type Violation, type HsnResult } from './rules';

export type DataSource = 'pb' | 'demo';

export interface V2Data {
  source: DataSource;
  points: V2Point[];
  assets: V2Asset[];
  installs: V2Install[];
  /** Vì sao rơi về dữ liệu mẫu — hiện nguyên văn cho người dùng. */
  reason?: string;
}

export const DEMO_DATA: V2Data = {
  source: 'demo',
  points: DEMO_POINTS, assets: DEMO_ASSETS, installs: DEMO_INSTALLS,
};

export async function fetchV2(): Promise<V2Data> {
  if (!isAuthed()) {
    return { ...DEMO_DATA, reason: 'Chưa đăng nhập PocketBase production' };
  }
  try {
    const opt = { requestKey: null } as const;
    const [points, assets, installs] = await Promise.all([
      pbv2.collection(V2_COLLECTIONS.point).getFullList<V2Point>({ sort: 'code', ...opt }),
      pbv2.collection(V2_COLLECTIONS.asset).getFullList<V2Asset>({ sort: 'serial', ...opt }),
      pbv2.collection(V2_COLLECTIONS.install).getFullList<V2Install>({ filter: 'is_current=true', ...opt }),
    ]);
    return { source: 'pb', points, assets, installs };
  } catch (e) {
    if (isAbort(e)) throw e;
    const err = e as { status?: number; message?: string };
    return {
      ...DEMO_DATA,
      reason: err.status === 404
        ? 'Collection v2_* chưa được tạo trên production'
        : (err.message ?? 'Không đọc được dữ liệu'),
    };
  }
}

/* ------------------------------------------------------------------ */

export interface PointView {
  point: V2Point;
  /** Vật tư đang treo tại điểm đo. */
  assets: V2Asset[];
  hsn: HsnResult;
  violations: Violation[];
  /** Có mâu thuẫn phải sửa ngay ⇒ khoá ghi. */
  locked: boolean;
  /** Còn lắp dở. */
  incomplete: boolean;
}

/** Ghép điểm đo với vật tư đang treo rồi chạy luật — dùng chung cho mọi màn hình. */
export function buildPointViews(d: V2Data): PointView[] {
  const byId = new Map(d.assets.map(a => [a.id, a]));
  const at = new Map<string, V2Asset[]>();
  for (const i of d.installs) {
    if (!i.is_current) continue;
    const a = byId.get(i.asset);
    if (!a) continue;
    if (!at.has(i.point)) at.set(i.point, []);
    at.get(i.point)!.push(a);
  }
  return d.points.map(point => {
    const assets = at.get(point.id) ?? [];
    const violations = pointViolations(point.point_status, assets);
    return {
      point, assets,
      hsn: hsnOf(assets),
      violations,
      locked: violations.some(v => v.level === 'sai'),
      incomplete: violations.some(v => v.level === 'thieu'),
    };
  });
}

/** Điểm đo mà một vật tư đang treo lên — để hiện ở bảng vật tư. */
export function pointOfAsset(d: V2Data, assetId: string): V2Point | undefined {
  const inst = d.installs.find(i => i.asset === assetId && i.is_current);
  return inst ? d.points.find(p => p.id === inst.point) : undefined;
}
