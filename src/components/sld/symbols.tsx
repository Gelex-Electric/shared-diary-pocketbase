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
  const d = data as SldNodeData;
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
  const d = data as SldNodeData;
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
  const d = data as SldNodeData;
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
  const d = data as SldNodeData;
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
  const d = data as SldNodeData;
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
  const d = data as SldNodeData;
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
