import type { SldDiagram } from '../types';

// ===================================================================
// SƠ ĐỒ MẪU — admin chỉ sửa file kiểu này để thêm/cập nhật.
// Quy ước: đi từ trên (nguồn) xuống dưới (tải).
// position: x càng lớn càng sang phải, y càng lớn càng xuống dưới.
// ===================================================================
export const tba471: SldDiagram = {
  id: 'tba-471',
  title: 'TBA 471 - Lộ 22kV',
  nodes: [
    { id: 'src',  type: 'source',       position: { x: 210, y: 0 },   data: { name: 'Nguồn 22kV', sub: 'Lộ 471' } },
    { id: 'bus',  type: 'busbar',       position: { x: 120, y: 90 },  data: { name: 'Thanh cái C41' } },
    { id: 'ds1',  type: 'disconnector', position: { x: 215, y: 130 }, data: { name: 'DCL 471-7', state: 'closed' } },
    { id: 'mc1',  type: 'breaker',      position: { x: 215, y: 215 }, data: { name: 'MC 471', state: 'closed' } },
    { id: 't1',   type: 'transformer',  position: { x: 210, y: 300 }, data: { name: 'T1', sub: '22/0,4kV' } },
    { id: 'mc2',  type: 'breaker',      position: { x: 215, y: 400 }, data: { name: 'MC 0,4kV', state: 'closed' } },
    { id: 'tai',  type: 'load',         position: { x: 210, y: 485 }, data: { name: 'Phụ tải', sub: '400V' } },
  ],
  edges: [
    { id: 'e1', source: 'src', target: 'bus' },
    { id: 'e2', source: 'bus', target: 'ds1' },
    { id: 'e3', source: 'ds1', target: 'mc1' },
    { id: 'e4', source: 'mc1', target: 't1' },
    { id: 'e5', source: 't1',  target: 'mc2' },
    { id: 'e6', source: 'mc2', target: 'tai' },
  ],
};
