import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { SldDiagram, SwitchState } from './types';
import { computeEnergized } from './energize';
import {
  SourceNode, BusbarNode, BreakerNode,
  DisconnectorNode, TransformerNode, LoadNode,
} from './symbols';

// Đăng ký symbol. Thêm loại thiết bị mới -> thêm 1 dòng ở đây.
const nodeTypes = {
  source: SourceNode,
  busbar: BusbarNode,
  breaker: BreakerNode,
  disconnector: DisconnectorNode,
  transformer: TransformerNode,
  load: LoadNode,
};

const ON = '#dc2626';
const OFF = '#94a3b8';

export default function SldViewer({ diagram }: { diagram: SldDiagram }) {
  // Trạng thái toggle CHỈ trong session — không lưu (reset khi F5 / đổi sơ đồ).
  const [switchState, setSwitchState] = useState<Record<string, SwitchState>>({});

  // Tính nhánh mang điện mỗi khi toggle.
  const energized = useMemo(
    () => computeEnergized({ nodes: diagram.nodes, edges: diagram.edges, switchState }),
    [diagram, switchState],
  );

  const rfNodes: Node[] = useMemo(
    () =>
      diagram.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          ...n.data,
          state: switchState[n.id] ?? n.data.state,
          energized: energized.has(n.id),
        },
      })),
    [diagram, switchState, energized],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      diagram.edges.map((e) => {
        const live = energized.has(e.source) && energized.has(e.target);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'step', // đường vuông góc cho SLD
          style: { stroke: live ? ON : OFF, strokeWidth: 2 },
        };
      }),
    [diagram, energized],
  );

  // Chỉ thiết bị đóng/cắt mới phản hồi click.
  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      const orig = diagram.nodes.find((n) => n.id === node.id);
      if (!orig || (orig.type !== 'breaker' && orig.type !== 'disconnector')) return;
      setSwitchState((prev) => {
        const cur = prev[node.id] ?? orig.data.state ?? 'closed';
        return { ...prev, [node.id]: cur === 'closed' ? 'open' : 'closed' };
      });
    },
    [diagram],
  );

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 480 }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        // ---- Khoá mọi tương tác chỉnh sửa, chỉ chừa xem + toggle ----
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnScroll
        panOnDrag
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  );
}
