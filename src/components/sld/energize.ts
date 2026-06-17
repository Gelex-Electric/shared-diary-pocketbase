import { SWITCHABLE, type SldNode, type SldEdge } from './types';

// ===================================================================
// Engine tô màu mang điện (energized analysis)
// Lan truyền điện từ các node nguồn theo graph, DỪNG tại thiết bị
// đóng/cắt đang ở trạng thái "open".
// ===================================================================

export interface EnergizeInput {
  nodes: SldNode[];
  edges: SldEdge[];
  /** Override trạng thái đóng/cắt theo id (do người dùng toggle runtime). */
  switchState: Record<string, 'closed' | 'open'>;
}

/** Trả về Set id các node đang mang điện. */
export function computeEnergized({ nodes, edges, switchState }: EnergizeInput): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Danh sách kề (vô hướng - điện truyền 2 chiều).
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }

  const isOpen = (id: string): boolean => {
    const n = byId.get(id);
    if (!n) return false;
    if (!SWITCHABLE.includes(n.type)) return false;
    const s = switchState[id] ?? n.data.state ?? 'closed';
    return s === 'open';
  };

  const energized = new Set<string>();
  const queue: string[] = [];

  // Điểm bắt đầu: các node nguồn.
  for (const n of nodes) {
    const isSource = n.data.isSource ?? n.type === 'source';
    if (isSource) {
      energized.add(n.id);
      queue.push(n.id);
    }
  }

  // BFS. Một thiết bị đang "open" vẫn được coi là mang điện ở phía
  // chạm tới nó, nhưng KHÔNG truyền tiếp sang phía bên kia.
  while (queue.length) {
    const cur = queue.shift()!;
    if (isOpen(cur)) continue; // chặn lan truyền qua thiết bị đang cắt
    for (const next of adj.get(cur) ?? []) {
      if (!energized.has(next)) {
        energized.add(next);
        queue.push(next);
      }
    }
  }

  return energized;
}
