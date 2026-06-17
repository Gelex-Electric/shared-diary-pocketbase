import type { SldDiagram } from '../types';

// ===================================================================
// SƠ ĐỒ KCN MẪU — minh hoạ đầy đủ symbol mới:
// Recloser, Cột điểm đấu, Tủ RMU 3 ngăn, LBS, DCL, MOF, MBA có gam kVA.
// Dựa trên từ vựng thực tế trong file SVG (REC 481, LBS/DCL 479-7, C41...).
// ===================================================================
export const kcnIp1: SldDiagram = {
  id: 'kcn-ip1',
  title: 'KCN — Trạm cắt IP-1 (mẫu)',
  nodes: [
    { id: 'src',  type: 'source',       position: { x: 360, y: 0 },   data: { name: 'Nguồn 22kV', sub: 'Lộ 471' } },
    { id: 'rec',  type: 'recloser',     position: { x: 358, y: 70 },  data: { name: 'REC 481/12', state: 'closed' } },
    { id: 'pole', type: 'pole',         position: { x: 363, y: 150 }, data: { name: 'Cột điểm đấu' } },
    { id: 'rmu',  type: 'rmu',          position: { x: 300, y: 220 }, data: { name: 'RMU IP-1', bays: 3 } },

    // ----- Ngăn 1: LBS → DCL → MOF → MBA T1 → khách hàng -----
    { id: 'lbs1', type: 'lbs',          position: { x: 95,  y: 300 }, data: { name: 'LBS 479-7', state: 'closed' } },
    { id: 'dcl1', type: 'disconnector', position: { x: 95,  y: 380 }, data: { name: 'DCL 479-7', state: 'closed' } },
    { id: 'mof1', type: 'mof',          position: { x: 90,  y: 458 }, data: { name: 'MOF', sub: '1 điểm đo chính' } },
    { id: 't1',   type: 'transformer',  position: { x: 90,  y: 540 }, data: { name: 'T1', sub: '1500kVA 22/0,4kV' } },
    { id: 'kh1',  type: 'load',         position: { x: 90,  y: 635 }, data: { name: 'ECOLAND' } },

    // ----- Ngăn 2: MC → MBA T2 → khách hàng -----
    { id: 'mc2',  type: 'breaker',      position: { x: 345, y: 300 }, data: { name: 'MC 432', state: 'closed' } },
    { id: 't2',   type: 'transformer',  position: { x: 340, y: 380 }, data: { name: 'T2', sub: '1000kVA 22/0,4kV' } },
    { id: 'kh2',  type: 'load',         position: { x: 340, y: 475 }, data: { name: 'GHN' } },

    // ----- Ngăn 3: DCL mở (dự kiến) → khách hàng -----
    { id: 'dcl3', type: 'disconnector', position: { x: 565, y: 300 }, data: { name: 'DCL 433-7', state: 'open' } },
    { id: 'kh3',  type: 'load',         position: { x: 560, y: 390 }, data: { name: 'DỰ KIẾN' } },
  ],
  edges: [
    { id: 'e1', source: 'src',  target: 'rec' },
    { id: 'e2', source: 'rec',  target: 'pole' },
    { id: 'e3', source: 'pole', target: 'rmu' },

    { id: 'b1', source: 'rmu', sourceHandle: 'bay1', target: 'lbs1' },
    { id: 'a1', source: 'lbs1', target: 'dcl1' },
    { id: 'a2', source: 'dcl1', target: 'mof1' },
    { id: 'a3', source: 'mof1', target: 't1' },
    { id: 'a4', source: 't1',   target: 'kh1' },

    { id: 'b2', source: 'rmu', sourceHandle: 'bay2', target: 'mc2' },
    { id: 'c1', source: 'mc2', target: 't2' },
    { id: 'c2', source: 't2',  target: 'kh2' },

    { id: 'b3', source: 'rmu', sourceHandle: 'bay3', target: 'dcl3' },
    { id: 'd1', source: 'dcl3', target: 'kh3' },
  ],
};
