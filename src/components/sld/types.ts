// ===================================================================
// Mô hình dữ liệu Sơ đồ một sợi (SLD)
// Admin chỉ cần khai báo theo các kiểu dưới đây trong file diagram.
// ===================================================================

/** Các loại thiết bị (symbol) được hỗ trợ. Thêm loại mới -> khai báo
 *  thêm component trong ./symbols và đăng ký ở SldViewer.nodeTypes. */
export type DeviceType =
  | 'source'      // Nguồn / xuất tuyến đến
  | 'busbar'      // Thanh cái (vd C41)
  | 'breaker'     // Máy cắt
  | 'recloser'    // Recloser (máy cắt tự đóng lại)
  | 'disconnector'// Dao cách ly (DCL)
  | 'lbs'         // Cầu dao phụ tải (Load Break Switch)
  | 'rmu'         // Tủ RMU nhiều ngăn
  | 'mof'         // Bộ đo lường (MOF)
  | 'pole'        // Cột điểm đấu
  | 'transformer' // Máy biến áp 2 cuộn
  | 'load';       // Phụ tải / khách hàng

/** Thiết bị đóng/cắt có 2 trạng thái. Các thiết bị khác bỏ qua field này. */
export type SwitchState = 'closed' | 'open';

/** Các loại thiết bị có thể đóng/cắt (phản hồi click + chặn lan truyền điện). */
export const SWITCHABLE: DeviceType[] = ['breaker', 'recloser', 'disconnector', 'lbs'];

export interface SldNodeData {
  /** Tên hiển thị, vd "MC 471", "T1 22/0,4kV" */
  name: string;
  /** Trạng thái ban đầu cho thiết bị đóng/cắt (breaker, disconnector). */
  state?: SwitchState;
  /** Nhãn phụ tuỳ chọn, vd cấp điện áp "22kV" hoặc gam máy "1500kVA 22/0,4kV". */
  sub?: string;
  /** Số ngăn của tủ RMU (2 hoặc 3). Chỉ dùng cho type === 'rmu'. */
  bays?: number;
  /** Nội bộ runtime: nhánh có đang mang điện không (engine tự gán). */
  energized?: boolean;
  /** true nếu là điểm cấp nguồn gốc của sơ đồ. Mặc định: type === 'source'. */
  isSource?: boolean;
}

export interface SldNode {
  id: string;
  type: DeviceType;
  /** Toạ độ admin tự đặt. Bật grid trong viewer để canh thẳng hàng. */
  position: { x: number; y: number };
  data: SldNodeData;
}

export interface SldEdge {
  id: string;
  source: string;
  target: string;
  /** Tên handle nguồn — dùng khi thiết bị có nhiều điểm ra, vd ngăn RMU: 'bay1'. */
  sourceHandle?: string;
  /** Tên handle đích — vd cột điểm đấu nối ngang: 'l' | 'r'. */
  targetHandle?: string;
}

/** Một sơ đồ hoàn chỉnh do admin định nghĩa. */
export interface SldDiagram {
  id: string;
  title: string;
  nodes: SldNode[];
  edges: SldEdge[];
}
