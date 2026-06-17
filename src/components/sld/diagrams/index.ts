import type { SldDiagram } from '../types';
import { parseDrawio } from '../drawio';
import { tba475 } from './tba-475';
import { kcnIp1 } from './kcn-ip1';

// Nạp bản vẽ draw.io (file .xml không nén) — Vite nhúng nội dung lúc build.
import tba471Xml from './tba-471.drawio.xml?raw';

// ===================================================================
// Registry tất cả sơ đồ.
//
// === THÊM SƠ ĐỒ MỚI TỪ draw.io (luồng khuyên dùng) ===
//   1) Vẽ ở draw.io -> Save/Export dạng XML KHÔNG nén (xem HUONG-DAN-VE-DRAWIO.md)
//   2) Bỏ file vào thư mục này, vd ./tba-xxx.drawio.xml
//   3) Thêm 2 dòng: import "...?raw" và 1 dòng parseDrawio bên dưới
//   4) git push -> Railway tự build & deploy
// (Vẫn hỗ trợ sơ đồ khai báo trực tiếp bằng TS như tba475 nếu cần.)
// ===================================================================
const tba471 = parseDrawio(tba471Xml, { id: 'tba-471', title: 'TBA 471 - Lộ 22kV' });

export const DIAGRAMS: Record<string, SldDiagram> = {
  [kcnIp1.id]: kcnIp1,
  [tba471.id]: tba471,
  [tba475.id]: tba475,
};

// Ánh xạ "mỗi user dùng 1 sơ đồ".
// Thay bằng dữ liệu thật từ PocketBase (vd field user.diagramId).
export const USER_DIAGRAM: Record<string, string> = {
  // 'userId_A': 'tba-471',
  // 'userId_B': 'tba-475',
};

/** Lấy sơ đồ cho 1 user. Fallback về sơ đồ đầu tiên nếu chưa gán. */
export function getDiagramForUser(userId?: string): SldDiagram {
  const id = (userId && USER_DIAGRAM[userId]) || Object.keys(DIAGRAMS)[0];
  return DIAGRAMS[id];
}
