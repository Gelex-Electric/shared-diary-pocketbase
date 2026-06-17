import type { SldDiagram } from '../types';
import { tba471 } from './tba-471';
import { tba475 } from './tba-475';

// ===================================================================
// Registry tất cả sơ đồ. Admin thêm sơ đồ mới:
//   1) tạo file ./tba-xxx.ts
//   2) import và thêm vào DIAGRAMS dưới đây
// ===================================================================
export const DIAGRAMS: Record<string, SldDiagram> = {
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
