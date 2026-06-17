import type { SldDiagram } from '../types';

// ===================================================================
// SƠ ĐỒ KCN MẪU — minh hoạ đầy đủ symbol mới:
// Recloser, Cột điểm đấu, Tủ RMU 3 ngăn, LBS, DCL, MOF, MBA có gam kVA.
//
// QUY ƯỚC TOẠ ĐỘ (để không bị chồng chéo):
//  - position.x là MÉP TRÁI của ký hiệu => tâm = x + (nửa bề rộng ký hiệu).
//  - Muốn 2 thiết bị thẳng cột thì cho TÂM bằng nhau (đã canh sẵn bên dưới).
//  - Nhãn hiển thị BÊN PHẢI ký hiệu nên chừa khoảng trống bên phải mỗi cột.
// Bề rộng ký hiệu: source/mof/transformer/load=60, recloser/lbs=56,
//                  breaker/disconnector=50, pole=50, rmu(3 ngăn)=102.
// ===================================================================
export const kcnIp1: SldDiagram = {
  id: 'kcn-ip1',
  title: 'KCN — Trạm cắt IP-1 (mẫu)',
  nodes: [
    // ----- Cột chính, tâm X = 380 -----
    { id: 'src',  type: 'source',       position: { x: 350, y: 20 },  data: { name: 'Nguồn 22kV', sub: 'Lộ 471' } },
    { id: 'rec',  type: 'recloser',     position: { x: 352, y: 90 },  data: { name: 'REC 481/12', state: 'closed' } },
    { id: 'pole', type: 'pole',         position: { x: 355, y: 170 }, data: { name: 'Cột điểm đấu' } },
    { id: 'rmu',  type: 'rmu',          position: { x: 329, y: 240 }, data: { name: 'RMU IP-1', bays: 3 } },

    // ----- Ngăn 1 (trái), tâm X = 150: LBS → DCL → MOF → T1 → khách hàng -----
    { id: 'lbs1', type: 'lbs',          position: { x: 122, y: 360 }, data: { name: 'LBS 479-7', state: 'closed' } },
    { id: 'dcl1', type: 'disconnector', position: { x: 125, y: 450 }, data: { name: 'DCL 479-7', state: 'closed' } },
    { id: 'mof1', type: 'mof',          position: { x: 120, y: 540 }, data: { name: 'MOF', sub: '1 điểm đo chính' } },
    { id: 't1',   type: 'transformer',  position: { x: 120, y: 630 }, data: { name: 'T1', sub: '1500kVA 22/0,4kV' } },
    { id: 'kh1',  type: 'load',         position: { x: 120, y: 730 }, data: { name: 'ECOLAND' } },

    // ----- Ngăn 2 (giữa), tâm X = 380: MC → T2 → khách hàng -----
    { id: 'mc2',  type: 'breaker',      position: { x: 355, y: 360 }, data: { name: 'MC 432', state: 'closed' } },
    { id: 't2',   type: 'transformer',  position: { x: 350, y: 450 }, data: { name: 'T2', sub: '1000kVA 22/0,4kV' } },
    { id: 'kh2',  type: 'load',         position: { x: 350, y: 560 }, data: { name: 'GHN' } },

    // ----- Ngăn 3 (phải), tâm X = 610: DCL mở (dự kiến) → khách hàng -----
    { id: 'dcl3', type: 'disconnector', position: { x: 585, y: 360 }, data: { name: 'DCL 433-7', state: 'open' } },
    { id: 'kh3',  type: 'load',         position: { x: 580, y: 450 }, data: { name: 'DỰ KIẾN' } },
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
