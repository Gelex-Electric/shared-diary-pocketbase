// ===================================================================
// Mô hình dữ liệu Sơ đồ một sợi (SLD)
// Admin chỉ cần khai báo theo các kiểu dưới đây trong file diagram.
// ===================================================================

/** Các loại thiết bị (symbol) được hỗ trợ. Thêm loại mới -> khai báo
 *  thêm component trong ./symbols và đăng ký ở SldViewer.nodeTypes. */
export type DeviceType =
  | 'source'      // Nguồn / xuất tuyến đến
  | 'busbar'      // Thanh cái
  | 'breaker'     // Máy cắt
  | 'disconnector'// Dao cách ly
  | 'transformer' // Máy biến áp 2 cuộn
  | 'load';       // Phụ tải

/** Thiết bị đóng/cắt có 2 trạng thái. Các thiết bị khác bỏ qua field này. */
export type SwitchState = 'closed' | 'open';

export interface SldNodeData {
  /** Tên hiển thị, vd "MC 471", "T1 22/0,4kV" */
  name: string;
  /** Trạng thái ban đầu cho thiết bị đóng/cắt (breaker, disconnector). */
  state?: SwitchState;
  /** Nhãn phụ tuỳ chọn, vd cấp điện áp "22kV". */
  sub?: string;
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
}

/** Một sơ đồ hoàn chỉnh do admin định nghĩa. */
export interface SldDiagram {
  id: string;
  title: string;
  nodes: SldNode[];
  edges: SldEdge[];
}
