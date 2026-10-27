/**
 * GHI kết quả đối chiếu nhu cầu ↔ treo thực tế (`reconcile` trong `supply.ts`) —
 * điểm đo hai phần, user chốt 27/10/2026.
 *
 * Chỉ làm một việc: gỡ các dòng NHU CẦU CHƯA TREO đã thừa (xoá lần lắp dự kiến,
 * bỏ giữ chỗ) ⇒ thiết bị về kho rảnh. Không bao giờ đụng dòng đã có ngày treo —
 * `reconcile` chỉ đưa dòng chưa treo vào `release`.
 * Tuần tự, không `Promise.all`: lỗi giữa chừng thì biết đã ghi tới đâu.
 */
import { assets as assetRepo, devices as deviceRepo, loadCatalog } from './repo';
import { reconcile, type ReconcileResult } from './supply';
import type { Point } from './types';

/** Nạp lại danh mục, đối chiếu một điểm đo, gỡ dòng thừa. Trả kết quả để báo người dùng. */
export async function runReconcile(pointId: string): Promise<ReconcileResult & { point?: Point }> {
  const d = await loadCatalog();
  const p = d.points.find(x => x.id === pointId);
  if (!p) return { release: [], shortages: [], extraHung: [] };
  const res = reconcile(p, d.assets, d.devices);
  for (const a of res.release) {
    await assetRepo.remove(a.id);
    const dev = a.device ? d.devices.find(x => x.id === a.device) : undefined;
    if (dev && dev.hold_point === pointId) await deviceRepo.update(dev.id, { hold_point: '' });
  }
  return { ...res, point: p };
}
