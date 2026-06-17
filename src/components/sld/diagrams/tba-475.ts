import type { SldDiagram } from '../types';

// Sơ đồ mẫu thứ 2 — minh hoạ "mỗi user 1 sơ đồ".
export const tba475: SldDiagram = {
  id: 'tba-475',
  title: 'TBA 475 - 2 phân đoạn',
  nodes: [
    { id: 'src',  type: 'source',       position: { x: 260, y: 0 },   data: { name: 'Nguồn 22kV', sub: 'Lộ 475' } },
    { id: 'bus',  type: 'busbar',       position: { x: 150, y: 90 },  data: { name: 'Thanh cái C45' } },
    // Nhánh A
    { id: 'mcA',  type: 'breaker',      position: { x: 155, y: 150 }, data: { name: 'MC 475-A', state: 'closed' } },
    { id: 'tA',   type: 'transformer',  position: { x: 150, y: 235 }, data: { name: 'TA', sub: '22/0,4kV' } },
    { id: 'loadA',type: 'load',         position: { x: 150, y: 350 }, data: { name: 'Tải A' } },
    // Nhánh B
    { id: 'mcB',  type: 'breaker',      position: { x: 320, y: 150 }, data: { name: 'MC 475-B', state: 'open' } },
    { id: 'tB',   type: 'transformer',  position: { x: 315, y: 235 }, data: { name: 'TB', sub: '22/0,4kV' } },
    { id: 'loadB',type: 'load',         position: { x: 315, y: 350 }, data: { name: 'Tải B' } },
  ],
  edges: [
    { id: 'e1', source: 'src', target: 'bus' },
    { id: 'a1', source: 'bus', target: 'mcA' },
    { id: 'a2', source: 'mcA', target: 'tA' },
    { id: 'a3', source: 'tA',  target: 'loadA' },
    { id: 'b1', source: 'bus', target: 'mcB' },
    { id: 'b2', source: 'mcB', target: 'tB' },
    { id: 'b3', source: 'tB',  target: 'loadB' },
  ],
};
