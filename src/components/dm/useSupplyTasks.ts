/**
 * Việc cần làm của luồng cấp vật tư cho MỘT nhóm — dùng cho badge ở sidebar và
 * màn "Việc cần làm" (đợt 4, 26/10/2026). Tính từ `loadCatalog` + `supplyTasks`,
 * không ai giao tay. Tự nạp lại mỗi 5 phút; màn con gọi `reload` sau khi ghi.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError, loadCatalog, type CatalogData } from '../../lib/dm/repo';
import { supplyTasks, taskCount, type SupplyTasks } from '../../lib/dm/supply';
import { inAreas, pointZoneId } from '../../lib/dm/pointScope';
import { useScopeAreas, type Scope } from '../../lib/scope';
import type { UserGroup } from '../../lib/userGroup';

const REFRESH_MS = 5 * 60 * 1000;
/** Gọi lại dày hơn mức này (vd mỗi lần đổi màn) thì bỏ qua — nạp danh mục là ~10 request. */
const MIN_GAP_MS = 20 * 1000;

export function useSupplyTasks(group: UserGroup) {
  // Vận Hành chỉ thấy việc ở KCN của mình; hai nhóm kia xem toàn bộ.
  const scope: Scope = group === 'van_hanh' ? 'doi' : 'vanphong';
  const { areas } = useScopeAreas(scope);
  const [data, setData] = useState<CatalogData | null>(null);
  const [tasks, setTasks] = useState<SupplyTasks | null>(null);
  const last = useRef(0);

  const reload = useCallback(async (force = false) => {
    if (!force && Date.now() - last.current < MIN_GAP_MS) return;
    last.current = Date.now();
    try {
      const d = await loadCatalog();
      const zoneName = new Map(d.zones.map(z => [z.id, z.name]));
      const inScope = scope === 'vanphong' ? undefined
        : (p: Parameters<typeof pointZoneId>[0]) => inAreas(zoneName.get(pointZoneId(p, d.stations, d.lines) ?? '') ?? '', areas);
      setData(d);
      setTasks(supplyTasks(d.points, d, new Date().toISOString().slice(0, 10), inScope));
    } catch (e) {
      // Badge là phụ — lỗi mạng thì giữ số cũ, không bật thông báo đỏ.
      if (!isAbortError(e)) console.warn('[useSupplyTasks]', e);
    }
  }, [scope, areas]);

  useEffect(() => {
    void reload(true);
    const t = setInterval(() => void reload(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { data, tasks, count: tasks ? taskCount(tasks, group) : 0, reload };
}
