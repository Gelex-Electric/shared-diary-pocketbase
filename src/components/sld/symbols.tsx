import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SldNodeData } from './types';

// ===================================================================
// Bộ ký hiệu SLD (custom nodes của React Flow).
// Mỗi symbol có Handle "in" (trên) và "out" (dưới) để cắm dây.
// Nhãn đặt BÊN PHẢI ký hiệu (chuẩn sơ đồ một sợi) nên dây dọc luôn sạch.
// ===================================================================

const ON = '#dc2626';   // mang điện -> đỏ
const OFF = '#94a3b8';  // mất điện -> xám
const stroke = (d: SldNodeData) => (d.energized ? ON : OFF);

function Pins({ top = true, bottom = true }: { top?: boolean; bottom?: boolean }) {
  return (
    <>
      {top && <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />}
      {bottom && <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />}
    </>
  );
}

/** Nhãn đặt tuyệt đối bên phải, căn giữa theo chiều cao ký hiệu.
 *  Vì position:absolute nên KHÔNG làm tăng kích thước node -> điểm nối
 *  (Handle) vẫn nằm sát mép ký hiệu, dây nối không bị nhãn chen vào. */
function SideLabel({
  name, sub, muted,
}: { name: string; sub?: string; muted?: boolean }) {
  return (
    <div
      style={{
        position: 'absolute', left: '100%', top: '50%',
        transform: 'translateY(-50%)', marginLeft: 6,
        whiteSpace: 'nowrap', textAlign: 'left', pointerEvents: 'none',
        lineHeight: 1.15,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: muted ? '#64748b' : '#1e293b' }}>{name}</div>
      {sub && <div style={{ fontSize: 9, color: '#94a3b8' }}>{sub}</div>}
    </div>
  );
}

/** Khung bọc chung: định vị tương đối để SideLabel bám theo. */
function box(width: number, clickable = false): React.CSSProperties {
  return { position: 'relative', width, ...(clickable ? { cursor: 'pointer' } : {}) };
}

const swText = (name: string, open: boolean) => `${name} ${open ? '(cắt)' : '(đóng)'}`;

// ---- Nguồn / xuất tuyến -------------------------------------------
export function SourceNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={box(60)}>
      <svg width="60" height="40" viewBox="0 0 60 40">
        <circle cx="30" cy="18" r="12" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <path d="M24 18 q3 -6 6 0 t6 0" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <line x1="30" y1="30" x2="30" y2="40" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins top={false} />
      <SideLabel name={d.name} sub={d.sub} />
    </div>
  );
}

// ---- Thanh cái ----------------------------------------------------
export function BusbarNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const w = d.width ?? 180;
  return (
    <div style={box(w)}>
      <svg width={w} height="10" viewBox={`0 0 ${w} 10`}>
        <rect x="0" y="3" width={w} height="4" fill={stroke(d)} />
      </svg>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <SideLabel name={d.name} muted />
    </div>
  );
}

// ---- Máy cắt (ô vuông) --------------------------------------------
export function BreakerNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={box(50, true)} title="Bấm để đóng/cắt">
      <svg width="50" height="44" viewBox="0 0 50 44">
        <line x1="25" y1="0" x2="25" y2="10" stroke={stroke(d)} strokeWidth="2" />
        <rect x="13" y="10" width="24" height="24" fill={open ? '#fff' : stroke(d)}
              stroke={stroke(d)} strokeWidth="2" />
        <line x1="25" y1="34" x2="25" y2="44" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <SideLabel name={swText(d.name, open)} muted={open} />
    </div>
  );
}

// ---- Dao cách ly (lưỡi dao) ---------------------------------------
export function DisconnectorNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={box(50, true)} title="Bấm để đóng/cắt">
      <svg width="50" height="44" viewBox="0 0 50 44">
        <line x1="25" y1="0" x2="25" y2="12" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="25" cy="12" r="2" fill={stroke(d)} />
        <line x1="25" y1="12" x2={open ? 38 : 25} y2={open ? 30 : 32}
              stroke={stroke(d)} strokeWidth="2" />
        <circle cx="25" cy="32" r="2" fill={stroke(d)} />
        <line x1="25" y1="32" x2="25" y2="44" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <SideLabel name={swText(d.name, open)} muted={open} />
    </div>
  );
}

// ---- Máy biến áp 2 cuộn (2 vòng tròn) -----------------------------
export function TransformerNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={box(60)}>
      <svg width="60" height="54" viewBox="0 0 60 54">
        <line x1="30" y1="0" x2="30" y2="8" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="30" cy="18" r="11" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="30" cy="32" r="11" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <line x1="30" y1="44" x2="30" y2="54" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <SideLabel name={d.name} sub={d.sub} />
    </div>
  );
}

// ---- Phụ tải (mũi tên) --------------------------------------------
export function LoadNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={box(60)}>
      <svg width="60" height="34" viewBox="0 0 60 34">
        <line x1="30" y1="0" x2="30" y2="14" stroke={stroke(d)} strokeWidth="2" />
        <path d="M22 14 L38 14 L30 32 Z" fill={stroke(d)} />
      </svg>
      <Pins bottom={false} />
      <SideLabel name={d.name} sub={d.sub} />
    </div>
  );
}

// ---- Recloser (REC) — máy cắt trong vòng tròn ----------------------
export function RecloserNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={box(56, true)} title="Bấm để đóng/cắt">
      <svg width="56" height="48" viewBox="0 0 56 48">
        <line x1="28" y1="0" x2="28" y2="8" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="28" cy="24" r="15" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <rect x="22" y="18" width="12" height="12" fill={open ? '#fff' : stroke(d)} stroke={stroke(d)} strokeWidth="1.5" />
        <line x1="28" y1="39" x2="28" y2="48" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <SideLabel name={swText(d.name, open)} muted={open} />
    </div>
  );
}

// ---- LBS — cầu dao phụ tải (dao + hộp dập hồ quang) ----------------
export function LbsNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={box(56, true)} title="Bấm để đóng/cắt">
      <svg width="56" height="48" viewBox="0 0 56 48">
        <line x1="28" y1="0" x2="28" y2="10" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="28" cy="10" r="2" fill={stroke(d)} />
        <line x1="28" y1="10" x2={open ? 42 : 28} y2={open ? 30 : 34} stroke={stroke(d)} strokeWidth="2" />
        <rect x="33" y="14" width="9" height="14" rx="1.5" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <circle cx="28" cy="34" r="2" fill={stroke(d)} />
        <line x1="28" y1="34" x2="28" y2="48" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <SideLabel name={swText(d.name, open)} muted={open} />
    </div>
  );
}

// ---- MOF — bộ đo lường (hộp + 2 vòng CT/VT) -----------------------
export function MofNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={box(60)}>
      <svg width="60" height="44" viewBox="0 0 60 44">
        <line x1="30" y1="0" x2="30" y2="6" stroke={stroke(d)} strokeWidth="2" />
        <rect x="14" y="6" width="32" height="30" rx="2" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="24" cy="21" r="6" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <circle cx="36" cy="21" r="6" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <line x1="30" y1="36" x2="30" y2="44" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <SideLabel name={d.name} sub={d.sub} />
    </div>
  );
}

// ---- Cột điểm đấu — cột rẽ nhánh -----------------------------------
export function PoleNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={box(50)}>
      <svg width="50" height="40" viewBox="0 0 50 40">
        <line x1="25" y1="0" x2="25" y2="40" stroke={stroke(d)} strokeWidth="2" />
        <line x1="8" y1="14" x2="42" y2="14" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="25" cy="14" r="3.5" fill={stroke(d)} />
      </svg>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id="l" type="source" position={Position.Left} style={{ opacity: 0, top: 14 }} />
      <Handle id="r" type="source" position={Position.Right} style={{ opacity: 0, top: 14 }} />
      <SideLabel name={d.name} />
    </div>
  );
}

// ---- Dao tiếp địa (nối đất) — vd -76, -38 -------------------------
// Mặc định MỞ (bình thường không nối đất). Là nhánh cụt rẽ ngang.
export function EarthNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'open') === 'open';
  return (
    <div style={box(44, true)} title="Bấm để đóng/cắt tiếp địa">
      <svg width="44" height="46" viewBox="0 0 44 46">
        {/* nhánh rẽ ngang từ đường dây (vào ở trên-trái) */}
        <line x1="6" y1="0" x2="6" y2="10" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="6" cy="10" r="2" fill={stroke(d)} />
        {/* lưỡi dao: mở = nghiêng, đóng = thẳng xuống */}
        <line x1="6" y1="10" x2={open ? 18 : 6} y2={open ? 26 : 28} stroke={stroke(d)} strokeWidth="2" />
        <circle cx="6" cy="28" r="2" fill={stroke(d)} />
        <line x1="6" y1="28" x2="6" y2="34" stroke={stroke(d)} strokeWidth="2" />
        {/* ký hiệu nối đất */}
        <line x1="-2" y1="34" x2="14" y2="34" stroke={stroke(d)} strokeWidth="2" />
        <line x1="1" y1="38" x2="11" y2="38" stroke={stroke(d)} strokeWidth="2" />
        <line x1="3" y1="42" x2="9" y2="42" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      {/* chỉ có đầu vào (nhánh cụt) */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, left: 6 }} />
      <div style={{
        position: 'absolute', left: 18, top: 4, whiteSpace: 'nowrap',
        pointerEvents: 'none', fontSize: 10, fontWeight: 600,
        color: open ? '#64748b' : '#1e293b',
      }}>{d.name} {open ? '(mở)' : '(đóng)'}</div>
    </div>
  );
}

// ---- Khung tủ RMU — hình nền bao quanh các ngăn -------------------
// Không tương tác; đặt phía sau (zIndex thấp) trong SldViewer.
export function FrameNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const w = d.width ?? 400;
  const h = d.height ?? 240;
  return (
    <div style={{
      width: w, height: h, boxSizing: 'border-box',
      border: '1.5px dashed #94a3b8', borderRadius: 6,
      background: 'rgba(148,163,184,0.06)', pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', top: -10, left: 10, padding: '0 6px',
        background: '#fff', fontSize: 11, fontWeight: 600, color: '#475569',
      }}>{d.name}</div>
    </div>
  );
}

// ---- RMU — tủ ring main unit 2–3 ngăn ------------------------------
export function RmuNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const bays = Math.min(3, Math.max(2, d.bays ?? 3));
  const cellW = 34;
  const w = bays * cellW;
  return (
    <div style={box(w)}>
      <svg width={w} height="56" viewBox={`0 0 ${w} 56`}>
        <rect x="1" y="10" width={w - 2} height="40" rx="2" fill="#f8fafc" stroke={stroke(d)} strokeWidth="2" />
        <line x1="6" y1="20" x2={w - 6} y2="20" stroke={stroke(d)} strokeWidth="2" />
        {Array.from({ length: bays }).map((_, i) => {
          const cx = i * cellW + cellW / 2;
          return (
            <g key={i}>
              {i > 0 && <line x1={i * cellW} y1="12" x2={i * cellW} y2="48" stroke={stroke(d)} strokeWidth="1" strokeDasharray="2 2" />}
              <line x1={cx} y1="20" x2={cx} y2="26" stroke={stroke(d)} strokeWidth="1.5" />
              <line x1={cx} y1="26" x2={cx + 5} y2="34" stroke={stroke(d)} strokeWidth="1.5" />
              <line x1={cx} y1="36" x2={cx} y2="56" stroke={stroke(d)} strokeWidth="2" />
            </g>
          );
        })}
        {/* nguồn vào tủ — ở CHÍNH GIỮA để thẳng với cột phía trên */}
        <line x1={w / 2} y1="0" x2={w / 2} y2="10" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      {/* handle vào (giữa, trên) + ra cho từng ngăn (dưới) */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, left: w / 2 }} />
      {Array.from({ length: bays }).map((_, i) => (
        <Handle key={i} id={`bay${i + 1}`} type="source" position={Position.Bottom}
                style={{ opacity: 0, left: i * cellW + cellW / 2 }} />
      ))}
      <SideLabel name={d.name} sub={`${bays} ngăn`} />
    </div>
  );
}
