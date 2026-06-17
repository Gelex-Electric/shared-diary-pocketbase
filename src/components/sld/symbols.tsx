import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { SldNodeData } from './types';

// ===================================================================
// Bộ ký hiệu SLD (custom nodes của React Flow).
// Mỗi symbol có Handle "in" (trên) và "out" (dưới) để cắm dây.
// Màu phụ thuộc data.energized do engine gán.
// ===================================================================

const ON = '#dc2626';   // mang điện -> đỏ (quy ước nội bộ, đổi tuỳ ý)
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

function Label({ data }: { data: SldNodeData }) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.2, marginTop: 2, color: '#1e293b', textAlign: 'center' }}>
      <div style={{ fontWeight: 600 }}>{data.name}</div>
      {data.sub && <div style={{ fontSize: 9, color: '#64748b' }}>{data.sub}</div>}
    </div>
  );
}

// ---- Nguồn / xuất tuyến -------------------------------------------
export function SourceNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={{ width: 60, textAlign: 'center' }}>
      <svg width="60" height="40" viewBox="0 0 60 40">
        <circle cx="30" cy="18" r="12" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <path d="M24 18 q3 -6 6 0 t6 0" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <line x1="30" y1="30" x2="30" y2="40" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins top={false} />
      <Label data={d} />
    </div>
  );
}

// ---- Thanh cái ----------------------------------------------------
export function BusbarNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={{ width: 180, textAlign: 'center' }}>
      <svg width="180" height="10" viewBox="0 0 180 10">
        <rect x="0" y="3" width="180" height="4" fill={stroke(d)} />
      </svg>
      {/* Thanh cái nhận và phát ở cả 2 phía */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div style={{ fontSize: 10, color: '#64748b' }}>{d.name}</div>
    </div>
  );
}

// ---- Máy cắt (ô vuông) --------------------------------------------
export function BreakerNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={{ width: 50, textAlign: 'center', cursor: 'pointer' }} title="Bấm để đóng/cắt">
      <svg width="50" height="44" viewBox="0 0 50 44">
        <line x1="25" y1="0" x2="25" y2="10" stroke={stroke(d)} strokeWidth="2" />
        <rect x="13" y="10" width="24" height="24" fill={open ? '#fff' : stroke(d)}
              stroke={stroke(d)} strokeWidth="2" />
        <line x1="25" y1="34" x2="25" y2="44" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <div style={{ fontSize: 10, color: open ? '#64748b' : '#1e293b', fontWeight: 600 }}>
        {d.name} {open ? '(cắt)' : '(đóng)'}
      </div>
    </div>
  );
}

// ---- Dao cách ly (lưỡi dao) ---------------------------------------
export function DisconnectorNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={{ width: 50, textAlign: 'center', cursor: 'pointer' }} title="Bấm để đóng/cắt">
      <svg width="50" height="44" viewBox="0 0 50 44">
        <line x1="25" y1="0" x2="25" y2="12" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="25" cy="12" r="2" fill={stroke(d)} />
        {/* lưỡi dao: đóng = thẳng, cắt = nghiêng */}
        <line x1="25" y1="12" x2={open ? 38 : 25} y2={open ? 30 : 32}
              stroke={stroke(d)} strokeWidth="2" />
        <circle cx="25" cy="32" r="2" fill={stroke(d)} />
        <line x1="25" y1="32" x2="25" y2="44" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <div style={{ fontSize: 10, color: open ? '#64748b' : '#1e293b', fontWeight: 600 }}>
        {d.name} {open ? '(cắt)' : '(đóng)'}
      </div>
    </div>
  );
}

// ---- Máy biến áp 2 cuộn (2 vòng tròn) -----------------------------
export function TransformerNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={{ width: 60, textAlign: 'center' }}>
      <svg width="60" height="54" viewBox="0 0 60 54">
        <line x1="30" y1="0" x2="30" y2="8" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="30" cy="18" r="11" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="30" cy="32" r="11" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <line x1="30" y1="44" x2="30" y2="54" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <Label data={d} />
    </div>
  );
}

// ---- Phụ tải (mũi tên) --------------------------------------------
export function LoadNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={{ width: 60, textAlign: 'center' }}>
      <svg width="60" height="34" viewBox="0 0 60 34">
        <line x1="30" y1="0" x2="30" y2="14" stroke={stroke(d)} strokeWidth="2" />
        <path d="M22 14 L38 14 L30 32 Z" fill={stroke(d)} />
      </svg>
      <Pins bottom={false} />
      <Label data={d} />
    </div>
  );
}

// ---- Recloser (REC) — máy cắt trong vòng tròn ----------------------
export function RecloserNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={{ width: 56, textAlign: 'center', cursor: 'pointer' }} title="Bấm để đóng/cắt">
      <svg width="56" height="48" viewBox="0 0 56 48">
        <line x1="28" y1="0" x2="28" y2="8" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="28" cy="24" r="15" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <rect x="22" y="18" width="12" height="12" fill={open ? '#fff' : stroke(d)} stroke={stroke(d)} strokeWidth="1.5" />
        <line x1="28" y1="39" x2="28" y2="48" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <div style={{ fontSize: 10, color: open ? '#64748b' : '#1e293b', fontWeight: 600 }}>
        {d.name} {open ? '(cắt)' : '(đóng)'}
      </div>
    </div>
  );
}

// ---- LBS — cầu dao phụ tải (dao + hộp dập hồ quang) ----------------
export function LbsNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  const open = (d.state ?? 'closed') === 'open';
  return (
    <div style={{ width: 56, textAlign: 'center', cursor: 'pointer' }} title="Bấm để đóng/cắt">
      <svg width="56" height="48" viewBox="0 0 56 48">
        <line x1="28" y1="0" x2="28" y2="10" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="28" cy="10" r="2" fill={stroke(d)} />
        {/* lưỡi dao */}
        <line x1="28" y1="10" x2={open ? 42 : 28} y2={open ? 30 : 34} stroke={stroke(d)} strokeWidth="2" />
        {/* hộp dập hồ quang (đặc trưng LBS) */}
        <rect x="33" y="14" width="9" height="14" rx="1.5" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <circle cx="28" cy="34" r="2" fill={stroke(d)} />
        <line x1="28" y1="34" x2="28" y2="48" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <div style={{ fontSize: 10, color: open ? '#64748b' : '#1e293b', fontWeight: 600 }}>
        {d.name} {open ? '(cắt)' : '(đóng)'}
      </div>
    </div>
  );
}

// ---- MOF — bộ đo lường (hộp + 2 vòng CT/VT) -----------------------
export function MofNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={{ width: 60, textAlign: 'center' }}>
      <svg width="60" height="44" viewBox="0 0 60 44">
        <line x1="30" y1="0" x2="30" y2="6" stroke={stroke(d)} strokeWidth="2" />
        <rect x="14" y="6" width="32" height="30" rx="2" fill="none" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="24" cy="21" r="6" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <circle cx="36" cy="21" r="6" fill="none" stroke={stroke(d)} strokeWidth="1.5" />
        <line x1="30" y1="36" x2="30" y2="44" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <Pins />
      <Label data={d} />
    </div>
  );
}

// ---- Cột điểm đấu — cột rẽ nhánh -----------------------------------
export function PoleNode({ data }: NodeProps) {
  const d = data as unknown as SldNodeData;
  return (
    <div style={{ width: 50, textAlign: 'center' }}>
      <svg width="50" height="40" viewBox="0 0 50 40">
        <line x1="25" y1="0" x2="25" y2="40" stroke={stroke(d)} strokeWidth="2" />
        <line x1="8" y1="14" x2="42" y2="14" stroke={stroke(d)} strokeWidth="2" />
        <circle cx="25" cy="14" r="3.5" fill={stroke(d)} />
      </svg>
      {/* cột đấu nối nhiều hướng */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle id="l" type="source" position={Position.Left} style={{ opacity: 0, top: 14 }} />
      <Handle id="r" type="source" position={Position.Right} style={{ opacity: 0, top: 14 }} />
      <Label data={d} />
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
    <div style={{ width: w, textAlign: 'center' }}>
      <svg width={w} height="56" viewBox={`0 0 ${w} 56`}>
        {/* vỏ tủ */}
        <rect x="1" y="10" width={w - 2} height="40" rx="2" fill="#f8fafc" stroke={stroke(d)} strokeWidth="2" />
        {/* thanh cái trong tủ */}
        <line x1="6" y1="20" x2={w - 6} y2="20" stroke={stroke(d)} strokeWidth="2" />
        {/* mỗi ngăn = 1 cầu dao đi xuống */}
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
        {/* nguồn vào tủ phía trên */}
        <line x1={cellW / 2} y1="0" x2={cellW / 2} y2="10" stroke={stroke(d)} strokeWidth="2" />
      </svg>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#1e293b' }}>
        {d.name} <span style={{ color: '#64748b', fontWeight: 400 }}>({bays} ngăn)</span>
      </div>
      {/* handle vào (trên) + ra cho từng ngăn (dưới) */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0, left: cellW / 2 }} />
      {Array.from({ length: bays }).map((_, i) => (
        <Handle key={i} id={`bay${i + 1}`} type="source" position={Position.Bottom}
                style={{ opacity: 0, left: i * cellW + cellW / 2 }} />
      ))}
    </div>
  );
}
