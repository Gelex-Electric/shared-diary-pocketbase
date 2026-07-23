/**
 * Auto-layout node cho sơ đồ một sợi bằng ELK (elkjs — engine thuần JS, chạy trong
 * trình duyệt). Trả về toạ độ {x,y} cho từng node để đưa thẳng vào ReactFlow.
 *
 * Vì sao ELK: sơ đồ 1 trạm còn tính toạ độ tay được, nhưng gộp NHIỀU trạm (cả KCN)
 * thì phải tự tránh chồng chéo — ELK 'layered' làm việc đó. Ta chỉ dùng ELK để
 * SẮP node (không dùng đường đi của ELK — ReactFlow tự vẽ edge theo handle).
 *
 * ReactFlow đo kích thước node sau khi render; nhưng ELK cần biết width/height
 * TRƯỚC, nên mỗi node phải kèm sẵn `width`/`height` (ước lượng theo loại node).
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

export interface LayoutInput {
  id: string;
  width: number;
  height: number;
}
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
}

/** Layout dọc (MBA trên → công tơ phụ dưới). Trả về map id → {x,y} (góc trên-trái). */
export async function layoutVertical(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  opts: Record<string, string> = {},
): Promise<Map<string, { x: number; y: number }>> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.spacing.nodeNode': '40',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...opts,
    },
    children: nodes.map(n => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map(e => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  const res = await elk.layout(graph);
  const pos = new Map<string, { x: number; y: number }>();
  for (const c of res.children ?? []) {
    pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
  }
  return pos;
}
