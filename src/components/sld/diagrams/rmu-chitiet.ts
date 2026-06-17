import type { SldDiagram } from '../types';

// ===================================================================
// TỦ RMU CHI TIẾT — 1 thanh cái, mỗi thiết bị là 1 nút đóng/cắt riêng.
// Quy ước số: số trơn = máy cắt; -7/-3 = dao cách ly / dao phụ tải;
//             -76/-38 = dao tiếp địa (mặc định MỞ).
//
//  Ngăn 471: dao phụ tải 471-7  + tiếp địa 471-76
//  Ngăn 431: dao cách ly 431-3  + tiếp địa 431-38
//  Ngăn 473: dao cách ly 473-3 + máy cắt 473 + tiếp địa 473-76
//
// (Ngăn liên lạc 412 — máy cắt + DCL nối 2 phân đoạn — sẽ thêm khi
//  chuyển sang cấu hình 2 thanh cái.)
// ===================================================================
export const rmuChiTiet: SldDiagram = {
  id: 'rmu-chitiet',
  title: 'Tủ RMU — chi tiết theo ngăn',
  nodes: [
    // Khung tủ (vẽ phía sau) bao quanh thanh cái + phần đóng cắt.
    { id: 'frame', type: 'frame', position: { x: 70, y: 70 },
      data: { name: 'Tủ RMU IP-1', width: 520, height: 250 } },

    // Nguồn + thanh cái C41
    { id: 'src', type: 'source', position: { x: 270, y: 10 }, data: { name: 'Nguồn 22kV', sub: 'Lộ 471' } },
    { id: 'bus', type: 'busbar', position: { x: 70, y: 95 }, data: { name: 'Thanh cái C41', width: 460 } },

    // ----- Ngăn 471: dao phụ tải -7 + tiếp địa -76 -----
    { id: 'lbs471', type: 'lbs',   position: { x: 122, y: 170 }, data: { name: '471-7', state: 'closed' } },
    { id: 'e47176', type: 'earth', position: { x: 185, y: 245 }, data: { name: '471-76', state: 'open' } },
    { id: 'kh471',  type: 'load',  position: { x: 120, y: 345 }, data: { name: 'ECOLAND' } },

    // ----- Ngăn 431: dao cách ly -3 + tiếp địa -38 -----
    { id: 'dcl431', type: 'disconnector', position: { x: 275, y: 170 }, data: { name: '431-3', state: 'closed' } },
    { id: 'e43138', type: 'earth',        position: { x: 338, y: 245 }, data: { name: '431-38', state: 'open' } },
    { id: 'kh431',  type: 'load',         position: { x: 270, y: 345 }, data: { name: 'GHN' } },

    // ----- Ngăn 473: dao cách ly -3 + máy cắt + tiếp địa -76 -----
    { id: 'dcl473', type: 'disconnector', position: { x: 435, y: 150 }, data: { name: '473-3', state: 'closed' } },
    { id: 'cb473',  type: 'breaker',      position: { x: 435, y: 228 }, data: { name: '473', state: 'closed' } },
    { id: 'e47376', type: 'earth',        position: { x: 498, y: 300 }, data: { name: '473-76', state: 'open' } },
    { id: 'kh473',  type: 'load',         position: { x: 430, y: 360 }, data: { name: 'KH 473' } },
  ],
  edges: [
    { id: 's1', source: 'src', target: 'bus' },

    { id: 'f1', source: 'bus', target: 'lbs471' },
    { id: 'x1', source: 'lbs471', target: 'e47176' },
    { id: 'l1', source: 'lbs471', target: 'kh471' },

    { id: 'f2', source: 'bus', target: 'dcl431' },
    { id: 'x2', source: 'dcl431', target: 'e43138' },
    { id: 'l2', source: 'dcl431', target: 'kh431' },

    { id: 'f3', source: 'bus', target: 'dcl473' },
    { id: 'cb', source: 'dcl473', target: 'cb473' },
    { id: 'x3', source: 'cb473', target: 'e47376' },
    { id: 'l3', source: 'cb473', target: 'kh473' },
  ],
};
