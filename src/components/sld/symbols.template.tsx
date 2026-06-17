// ===================================================================
// KHUÔN MẪU TẠO SYMBOL MỚI  —  copy hàm bên dưới, đổi tên, dán hình SVG.
// Không cần biết React: chỉ sửa 4 chỗ đánh số (1)(2)(3)(4).
//
// CÁCH DÙNG:
//   B1. Vẽ ký hiệu ở Boxy SVG / Inkscape / draw.io, canvas vd 60x50,
//       NHỚ vẽ trục dọc đi qua CHÍNH GIỮA (x = nửa chiều rộng).
//   B2. Copy phần bên trong <svg>...</svg> (các <line> <circle> <rect> <path>).
//   B3. Dán vào chỗ (2) bên dưới, đổi mọi stroke="#..." -> stroke={stroke(d)}.
//   B4. Copy hàm này sang ./symbols.tsx, rồi đăng ký trong SldViewer.tsx:
//          import { MyDeviceNode } from './symbols';
//          nodeTypes = { ..., mydevice: MyDeviceNode }
//       và thêm 'mydevice' vào DeviceType trong ./types.ts.
// ===================================================================
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SldNodeData } from './types';

// Màu tự đổi theo điện: đỏ = mang điện, xám = mất điện. ĐỪNG gõ màu cứng.
const stroke = (d: SldNodeData) => (d.energized ? '#dc2626' : '#94a3b8');

export function MyDeviceNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  // Nếu là thiết bị đóng/cắt, đọc trạng thái để vẽ khác đi (tuỳ chọn):
  const open = (d.state ?? 'closed') === 'open';

  return (
    <div style={{ width: 60 /* (1) đổi cho khớp chiều rộng viewBox */, textAlign: 'center' }}>
      <svg width="60" height="50" viewBox="0 0 60 50">
        {/* (2) ====== DÁN HÌNH SVG CỦA BẠN VÀO ĐÂY ======
             - Trục dọc qua giữa: x = 30 (nửa của 60)
             - Màu: stroke={stroke(d)} thay cho stroke="#000"
             - Muốn vẽ khác khi cắt: dùng biến `open` ở trên
             Ví dụ mẫu (một ô vuông có dây trên/dưới): */}
        <line x1="30" y1="0"  x2="30" y2="14" stroke={stroke(d)} strokeWidth="2" />
        <rect x="18" y="14" width="24" height="22"
              fill={open ? '#fff' : stroke(d)} stroke={stroke(d)} strokeWidth="2" />
        <line x1="30" y1="36" x2="30" y2="50" stroke={stroke(d)} strokeWidth="2" />
      </svg>

      {/* (3) Điểm nối. Mặc định có cả trên & dưới.
             - Chỉ có đầu vào (vd phụ tải):  <Handle .. Position.Top .. /> bỏ cái Bottom
             - Chỉ có đầu ra  (vd nguồn):     bỏ cái Top */}
      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />

      {/* (4) Nhãn tên + dòng phụ (sub). Giữ nguyên là được. */}
      <div style={{ fontSize: 11, marginTop: 2, color: '#1e293b', fontWeight: 600 }}>
        {d.name}
      </div>
      {d.sub && <div style={{ fontSize: 9, color: '#64748b' }}>{d.sub}</div>}
    </div>
  );
}
