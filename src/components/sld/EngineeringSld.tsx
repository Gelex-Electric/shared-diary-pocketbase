/**
 * Renderer SƠ ĐỒ MỘT SỢI KỸ THUẬT — vẽ từ CÂY THIẾT BỊ trong PocketBase `sld_node`
 * (Phương án B: adjacency list `parent`, KHÔNG lưu toạ độ).
 *
 * Luồng: sld_node (cây) -> ReactFlow nodes/edges (chưa toạ độ) -> ELK layered tính toạ độ
 *   -> lượt 2: (a) thanh cái tự TRẢI theo vị trí nhánh con thật;
 *              (b) KHUNG TỦ (`enclosure`) tự tính bbox ôm các thiết bị cùng tủ.
 *
 * Quy tắc nhãn (tránh đè nhau, vì nhãn KHÔNG được tính vào layout của ELK):
 *   - Thiết bị đứng một mình trên trục (KIOS/MBA/điểm đo/ACB) -> nhãn BÊN PHẢI (bên cạnh trống).
 *   - Thiết bị có anh em cạnh nhau (các MCCB dưới thanh cái) -> nhãn XUỐNG DƯỚI, canh giữa.
 *
 * Thông tin công tơ (tên KH/HSN/role) luôn tra động từ station_map theo `meter_no`.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, Handle, Position, useReactFlow,
  type Node, type Edge, type NodeProps,
} from '@xyflow/react';
import { ArrowUpCircle, ArrowDownCircle, Lock, Cable } from 'lucide-react';
import { MeterInfoRow, canEditMeter } from '../../lib/meterInfo';
import { fetchSldNodes, childrenOf, SldNodeRec } from '../../lib/sldNodes';
import { layoutVertical } from './elkLayout';
import { EmptyState } from '../ui/dashboard';

const STROKE = 1.7;

/* --------- ký hiệu: đều có trục dọc XUYÊN QUA để đường dây liền mạch --------- */
const XfmrSvg = () => (
  <svg width="64" height="88" viewBox="0 0 64 88" className="text-ink" fill="none" stroke="currentColor" strokeWidth={STROKE}>
    <line x1="32" y1="0" x2="32" y2="24" />
    <circle cx="32" cy="36" r="14" /><circle cx="32" cy="52" r="14" />
    <line x1="32" y1="66" x2="32" y2="88" />
  </svg>
);
const MeterSvg = () => (
  <svg width="64" height="60" viewBox="0 0 64 60" className="text-ink" fill="none" stroke="currentColor" strokeWidth={STROKE}>
    <line x1="32" y1="0" x2="32" y2="16" />
    <circle cx="32" cy="30" r="14" />
    <text x="32" y="34" textAnchor="middle" fontSize="11" fill="currentColor" stroke="none">Wh</text>
    <line x1="32" y1="44" x2="32" y2="60" />
  </svg>
);
// Máy cắt: tiếp điểm hở + Ô VUÔNG ĐẶC tại tiếp điểm cố định (dấu hiệu phân biệt máy cắt)
const BreakerSvg = () => (
  <svg width="64" height="60" viewBox="0 0 64 60" className="text-ink" fill="none" stroke="currentColor" strokeWidth={STROKE}>
    <line x1="32" y1="0" x2="32" y2="18" />
    <rect x="28" y="14" width="8" height="8" fill="currentColor" stroke="none" />
    <circle cx="32" cy="42" r="2.2" fill="currentColor" stroke="none" />
    <line x1="32" y1="42" x2="46" y2="20" />
    <line x1="32" y1="42" x2="32" y2="60" />
  </svg>
);
// Dao cách ly: GIỐNG máy cắt nhưng KHÔNG có ô vuông (chỉ lưỡi dao hở) — đúng phân biệt IEC
const DisconnectorSvg = () => (
  <svg width="64" height="60" viewBox="0 0 64 60" className="text-ink" fill="none" stroke="currentColor" strokeWidth={STROKE}>
    <line x1="32" y1="0" x2="32" y2="18" />
    <circle cx="32" cy="42" r="2.2" fill="currentColor" stroke="none" />
    <line x1="32" y1="42" x2="46" y2="20" />
    <line x1="32" y1="42" x2="32" y2="60" />
  </svg>
);
/** Dao tiếp địa: nhánh RẼ NGANG từ đường trục -> lưỡi dao hở -> ký hiệu đất.
 *  Điểm nối vào trục = góc phải, toạ độ cục bộ (76, 8). */
const EarthSvg = () => (
  <svg width="76" height="56" viewBox="0 0 76 56" className="text-ink" fill="none" stroke="currentColor" strokeWidth={STROKE}>
    <line x1="76" y1="8" x2="50" y2="8" />
    <circle cx="50" cy="8" r="2.2" fill="currentColor" stroke="none" />
    <line x1="50" y1="8" x2="34" y2="23" />
    <circle cx="30" cy="28" r="2.2" fill="currentColor" stroke="none" />
    <line x1="30" y1="28" x2="30" y2="40" />
    <line x1="18" y1="42" x2="42" y2="42" />
    <line x1="23" y1="47" x2="37" y2="47" />
    <line x1="27" y1="52" x2="33" y2="52" />
  </svg>
);
const ArrowSvg = () => (
  <svg width="64" height="34" viewBox="0 0 64 34" className="text-ink" fill="currentColor" stroke="currentColor" strokeWidth={STROKE}>
    <line x1="32" y1="0" x2="32" y2="20" stroke="currentColor" />
    <polygon points="23,18 41,18 32,34" stroke="none" />
  </svg>
);

/* ------------------------------- node types ------------------------------- */
type Glyph = 'xfmr' | 'meter' | 'breaker' | 'dcl';
type DeviceData = Record<string, unknown> & {
  label: string; sub?: string; glyph: Glyph; labelBelow: boolean; width: number;
};
const glyphOf = (g: Glyph) =>
  g === 'xfmr' ? <XfmrSvg /> : g === 'meter' ? <MeterSvg /> : g === 'dcl' ? <DisconnectorSvg /> : <BreakerSvg />;

/** Dao tiếp địa — node RIÊNG nhưng KHÔNG đưa vào ELK; vị trí tự tính bám vào trục
 *  của thiết bị cha (xem lượt 2c), nếu không ELK sẽ xếp nó thành nối tiếp (sai). */
function EarthNode({ data }: NodeProps<Node<Record<string, unknown> & { label: string }>>) {
  return (
    <div className="relative" style={{ width: EARTH_W, pointerEvents: 'none' }}>
      <EarthSvg />
      <div className="text-[9px] text-soft text-center leading-none" style={{ width: 60 }}>{data.label}</div>
    </div>
  );
}

function DeviceNode({ data }: NodeProps<Node<DeviceData>>) {
  const sym = glyphOf(data.glyph);
  if (data.labelBelow) {
    // có anh em cạnh nhau -> nhãn xuống dưới, canh giữa (không đè nhánh bên)
    return (
      <div className="flex flex-col items-center" style={{ width: data.width }}>
        <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
        {sym}
        <div className="text-[9px] text-soft text-center leading-tight mt-0.5 px-1">{data.label}</div>
        <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
      </div>
    );
  }
  return (
    <div className="relative flex justify-center" style={{ width: DEVICE_W }}>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      {sym}
      <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 text-left"
        style={{ width: LABEL_W, pointerEvents: 'none' }}>
        <div className="text-xs font-semibold text-ink leading-tight">{data.label}</div>
        {data.sub && <div className="text-[11px] text-soft leading-tight">{data.sub}</div>}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

/** Tủ trung thế / nguồn: vẽ thành hộp tủ có nhãn bên trong. */
function SourceNode({ data }: NodeProps<Node<Record<string, unknown> & { label: string }>>) {
  return (
    <div className="flex items-center justify-center rounded-md border-2 border-[var(--ink)] bg-[var(--card)] px-3 text-center"
      style={{ width: SOURCE_W, height: SOURCE_H }}>
      <span className="text-xs font-semibold text-ink leading-tight">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0" />
    </div>
  );
}

type BusData = Record<string, unknown> & {
  label: string; width: number; handleIds: string[]; handleLefts: number[]; inLeft: number;
};
function BusbarNode({ data }: NodeProps<Node<BusData>>) {
  const { label, width, handleIds, handleLefts, inLeft } = data;
  return (
    <div className="relative" style={{ width, height: 8 }}>
      <Handle id="in" type="target" position={Position.Top} className="!bg-transparent !border-0"
        style={{ left: `${inLeft}%` }} />
      <div className="absolute inset-0 rounded-sm bg-accent" />
      <div className="absolute left-0 -top-5 text-[11px] text-soft whitespace-nowrap">{label}</div>
      {handleIds.map((hid, i) => (
        <Handle key={hid} id={hid} type="source" position={Position.Bottom}
          style={{ left: `${handleLefts[i]}%` }} className="!bg-transparent !border-0" />
      ))}
    </div>
  );
}

interface FeederData extends Record<string, unknown> {
  label?: string; meter?: MeterInfoRow; editable: boolean; busy: boolean;
  onToggle?: (m: MeterInfoRow) => void;
}
function FeederNode({ data }: NodeProps<Node<FeederData>>) {
  const { meter, label, editable, busy, onToggle } = data;
  const isMain = meter?.ROLE === 'chinh';
  return (
    <div className="relative flex flex-col items-center" style={{ width: FEEDER_W }}>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0" />
      <ArrowSvg />
      {meter ? (
        <div className="text-center mt-0.5">
          <div className="font-mono text-xs text-ink">{meter.METER_NO}</div>
          <div className={`text-[10px] font-semibold uppercase ${isMain ? 'text-accent' : 'text-soft'}`}>
            {isMain ? 'Chính' : 'Phụ'}
          </div>
          <div className="text-[11px] text-soft truncate max-w-[150px]" title={meter.CUSTOMER_NAME}>
            {meter.CUSTOMER_NAME || '—'}
          </div>
          <div className="text-[10px] text-dim">HSN: {meter.METER_NAME || '—'}</div>
          {editable && onToggle ? (
            <button disabled={busy} onClick={() => onToggle(meter)}
              className="mt-1 inline-flex items-center justify-center gap-1 text-[11px] rounded border border-[var(--border)] px-2 py-0.5 hover:border-accent hover:text-accent disabled:opacity-50">
              {isMain ? <ArrowDownCircle className="w-3 h-3" /> : <ArrowUpCircle className="w-3 h-3" />}
              {isMain ? 'Thành phụ' : 'Thành chính'}
            </button>
          ) : (
            <div className="mt-1 flex items-center justify-center gap-1 text-[10px] text-dim">
              <Lock className="w-3 h-3" /> Ngoài KCN
            </div>
          )}
        </div>
      ) : (
        <div className="text-center mt-0.5 text-[11px] text-dim">{label || 'Dự phòng'}</div>
      )}
    </div>
  );
}

/** Khung bao tủ (vd "Tủ MSB NX9") — bbox tự tính sau layout, nằm DƯỚI mọi thứ. */
function EnclosureNode({ data }: NodeProps<Node<Record<string, unknown> & { label: string; width: number; height: number }>>) {
  return (
    <div className="relative rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--ink)]/[0.03]"
      style={{ width: data.width, height: data.height, pointerEvents: 'none' }}>
      <span className="absolute -top-2.5 left-4 px-2 bg-[var(--card)] text-[11px] font-semibold text-soft rounded">
        {data.label}
      </span>
    </div>
  );
}

const nodeTypes = { device: DeviceNode, source: SourceNode, busbar: BusbarNode, feeder: FeederNode, enclosure: EnclosureNode, earth: EarthNode };

/* -------------------------------- layout -------------------------------- */
const DEVICE_W = 64;         // node chỉ có ký hiệu (nhãn bên phải, không tính vào layout)
const DEVICE_W_BELOW = 150;  // node có nhãn xuống dưới (đứng cạnh anh em)
/** Node có dao tiếp địa rẽ ngang -> phải rộng hơn để ELK CHỪA CHỖ cho nhánh
 *  (dao tiếp địa không nằm trong graph ELK nên ELK không tự biết). */
const DEVICE_W_EARTH = 200;
const LABEL_W = 230;         // bề rộng khối nhãn bên phải
const FEEDER_W = 150;
const SOURCE_W = 170, SOURCE_H = 48;
const EARTH_W = 76, EARTH_H = 70;   // gồm cả nhãn dưới ký hiệu đất
const H = { xfmr: 88, meter: 60, breaker: 60, breakerBelow: 88, feeder: 150, busbar: 8 };
const BUS_PAD = 24;
/** Bề rộng ƯỚC LƯỢNG thanh cái lúc layout — chỉ để ELK canh trục chính vào giữa.
 *  Bề rộng THẬT tính lại ở lượt 2 theo vị trí nhánh con thực tế. */
const BUS_COL = 190;
/** Đệm khung tủ. */
const ENC_PAD = 26, ENC_PAD_TOP = 34;

interface Props {
  stationKey: string;
  meters: MeterInfoRow[];
  busy: boolean;
  onToggle: (m: MeterInfoRow) => void;
}

export default function EngineeringSld({ stationKey, meters, busy, onToggle }: Props) {
  const [rows, setRows] = useState<SldNodeRec[] | null>(null);

  useEffect(() => {
    let ok = true;
    setRows(null);
    fetchSldNodes(stationKey)
      .then(r => { if (ok) setRows(r); })
      .catch(e => { console.error('Lỗi tải sld_node:', e); if (ok) setRows([]); });
    return () => { ok = false; };
  }, [stationKey]);

  const byNo = useMemo(() => {
    const m = new Map<string, MeterInfoRow>();
    for (const r of meters) m.set(r.METER_NO, r);
    return m;
  }, [meters]);

  /* Cây PB -> node/edge ReactFlow (chưa toạ độ) + kích thước cho ELK. */
  const spec = useMemo(() => {
    if (!rows?.length) return null;
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const dims = new Map<string, { width: number; height: number }>();
    const labelRight = new Set<string>();   // node có nhãn tràn sang phải (dùng khi tính bbox khung)
    const earths: { rec: SldNodeRec; parent: string }[] = [];  // dao tiếp địa: KHÔNG vào ELK

    /** Con "thật" (bỏ dao tiếp địa — nó là nhánh rẽ ngang, không phải nối tiếp). */
    const realKids = (id: string) => childrenOf(rows, id).filter(k => k.type !== 'earth');
    /** true nếu node có anh em đứng cạnh -> nhãn phải xuống dưới để không đè. */
    const hasSiblings = (r: SldNodeRec) => !!r.parent && realKids(r.parent).length > 1;
    /** true nếu node có dao tiếp địa rẽ ngang -> cần chừa chỗ. */
    const hasEarth = (id: string) => childrenOf(rows, id).some(k => k.type === 'earth');

    for (const r of rows) {
      const meter = r.meter_no ? byNo.get(r.meter_no) : undefined;

      if (r.type === 'earth') {
        // node riêng, vị trí tính sau theo cha (lượt 2c) — không đưa vào ELK
        nodes.push({
          id: r.id, type: 'earth', position: { x: 0, y: 0 }, draggable: false, selectable: false,
          data: { label: r.label || '' },
        });
        if (r.parent) earths.push({ rec: r, parent: r.parent });
        continue;
      }

      if (r.type === 'source') {
        nodes.push({ id: r.id, type: 'source', position: { x: 0, y: 0 }, draggable: false,
          data: { label: r.label || 'Nguồn' } });
        dims.set(r.id, { width: SOURCE_W, height: SOURCE_H });
      } else if (r.type === 'busbar') {
        const kids = realKids(r.id);
        nodes.push({
          id: r.id, type: 'busbar', position: { x: 0, y: 0 }, draggable: false,
          data: {
            label: r.label || 'Thanh cái', width: BUS_COL,
            handleIds: kids.map(k => `h-${k.id}`), handleLefts: kids.map(() => 50), inLeft: 50,
          } as BusData,
        });
        dims.set(r.id, { width: Math.max(kids.length * BUS_COL, 40), height: H.busbar });
      } else if (r.type === 'feeder') {
        nodes.push({
          id: r.id, type: 'feeder', position: { x: 0, y: 0 }, draggable: false,
          data: {
            label: r.label, meter, busy, onToggle,
            editable: !!meter && !!meter._id && canEditMeter(meter.CUSTOMER_CODE),
          } as FeederData,
        });
        dims.set(r.id, { width: FEEDER_W, height: H.feeder });
      } else {
        const glyph: Glyph = r.type === 'transformer' ? 'xfmr'
          : r.type === 'meter' ? 'meter'
          : r.type === 'disconnector' ? 'dcl' : 'breaker';
        const below = hasSiblings(r);
        const earthed = hasEarth(r.id);
        const width = below ? (earthed ? DEVICE_W_EARTH : DEVICE_W_BELOW) : DEVICE_W;
        const sub = r.type === 'meter' && meter
          ? `${meter.CUSTOMER_NAME} · HSN ${meter.METER_NAME || '—'}`
          : undefined;
        const label = r.type === 'meter' && r.meter_no
          ? `${r.label || 'Điểm đo'} · ${r.meter_no}` : (r.label || '');
        nodes.push({
          id: r.id, type: 'device', position: { x: 0, y: 0 }, draggable: false,
          data: { label, sub, glyph, labelBelow: below, width } as DeviceData,
        });
        const h = glyph === 'xfmr' ? H.xfmr : below ? H.breakerBelow : H.breaker;
        dims.set(r.id, { width, height: h });
        if (!below) labelRight.add(r.id);
      }

      if (r.parent) {
        const parent = rows.find(x => x.id === r.parent);
        edges.push({
          id: `e-${r.parent}-${r.id}`, source: r.parent, target: r.id, type: 'straight',
          ...(parent?.type === 'busbar' ? { sourceHandle: `h-${r.id}` } : {}),
          ...(r.type === 'busbar' ? { targetHandle: 'in' } : {}),
        });
      }
    }
    return { nodes, edges, dims, rows, labelRight, earths };
  }, [rows, byNo, busy, onToggle]);

  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(() => {
    if (!spec) { setNodes([]); return; }
    let cancelled = false;
    // dao tiếp địa KHÔNG vào ELK (nó là nhánh rẽ ngang, không phải nối tiếp)
    const lNodes = spec.nodes.filter(n => n.type !== 'earth')
      .map(n => ({ id: n.id, ...spec.dims.get(n.id)! }));
    const inElk = new Set(lNodes.map(n => n.id));
    const lEdges = spec.edges.filter(e => inElk.has(e.source!) && inElk.has(e.target!))
      .map(e => ({ id: e.id, source: e.source!, target: e.target! }));

    layoutVertical(lNodes, lEdges).then(pos => {
      if (cancelled) return;
      const centerOf = (id: string) => {
        const p = pos.get(id); const d = spec.dims.get(id);
        return p && d ? p.x + d.width / 2 : 0;
      };

      /* ---- LƯỢT 2a: thanh cái tự trải theo vị trí nhánh con thật ---- */
      const busGeom = new Map<string, { x: number; width: number }>();
      const positioned = spec.nodes.filter(n => n.type !== 'earth').map(n => {
        const p = pos.get(n.id) ?? { x: 0, y: 0 };
        if (n.type !== 'busbar') return { ...n, position: p };
        const rec = spec.rows.find(r => r.id === n.id)!;
        const kids = childrenOf(spec.rows, n.id).filter(k => k.type !== 'earth');
        const centers = kids.map(k => centerOf(k.id));
        const left = Math.min(...centers) - BUS_PAD;
        const width = Math.max(Math.max(...centers) + BUS_PAD - left, 40);
        busGeom.set(n.id, { x: left, width });
        return {
          ...n, position: { x: left, y: p.y },
          data: {
            ...n.data, width,
            handleIds: kids.map(k => `h-${k.id}`),
            handleLefts: centers.map(c => ((c - left) / width) * 100),
            inLeft: rec.parent ? ((centerOf(rec.parent) - left) / width) * 100 : 50,
          },
        };
      });

      /* ---- LƯỢT 2c: dao tiếp địa bám vào trục của thiết bị cha ----
         Điểm nối (76,8) của EarthSvg phải trùng trục dọc cha, tại giữa chiều cao cha. */
      const earthBox = new Map<string, { x: number; y: number }>();
      const earthNodes: Node[] = [];
      for (const { rec, parent } of spec.earths) {
        const pp = pos.get(parent); const pd = spec.dims.get(parent);
        if (!pp || !pd) continue;
        const x = pp.x + pd.width / 2 - EARTH_W;
        const y = pp.y + pd.height / 2 - 8;
        earthBox.set(rec.id, { x, y });
        const n = spec.nodes.find(z => z.id === rec.id)!;
        earthNodes.push({ ...n, position: { x, y } });
      }

      /* ---- LƯỢT 2b: khung tủ tự ôm bbox các thiết bị cùng `enclosure` ---- */
      const groups = new Map<string, SldNodeRec[]>();
      for (const r of spec.rows) {
        if (!r.enclosure) continue;
        const g = groups.get(r.enclosure) ?? [];
        g.push(r); groups.set(r.enclosure, g);
      }
      const frames: Node[] = [];
      for (const [name, members] of groups) {
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const m of members) {
          const eb = earthBox.get(m.id);
          if (eb) {   // dao tiếp địa: box tự tính, không có trong ELK
            left = Math.min(left, eb.x); top = Math.min(top, eb.y);
            right = Math.max(right, eb.x + EARTH_W); bottom = Math.max(bottom, eb.y + EARTH_H);
            continue;
          }
          const p = pos.get(m.id); const d = spec.dims.get(m.id);
          if (!p || !d) continue;
          const bg = busGeom.get(m.id);                       // thanh cái đã trải lại
          const x = bg ? bg.x : p.x;
          const w = bg ? bg.width : d.width;
          // nhãn bên phải không nằm trong dims -> cộng thêm để khung ôm trọn nhãn
          const wRight = w + (spec.labelRight.has(m.id) ? LABEL_W + 8 : 0);
          left = Math.min(left, x); top = Math.min(top, p.y);
          right = Math.max(right, x + wRight); bottom = Math.max(bottom, p.y + d.height);
        }
        if (!isFinite(left)) continue;
        frames.push({
          id: `enc-${name}`, type: 'enclosure', draggable: false, selectable: false, zIndex: -1,
          position: { x: left - ENC_PAD, y: top - ENC_PAD_TOP },
          data: {
            label: name,
            width: right - left + ENC_PAD * 2,
            height: bottom - top + ENC_PAD_TOP + ENC_PAD,
          },
        });
      }

      setNodes([...frames, ...positioned, ...earthNodes]);   // khung vẽ trước -> nằm dưới
    }).catch(e => console.error('ELK layout lỗi:', e));
    return () => { cancelled = true; };
  }, [spec]);

  if (rows === null) return <EmptyState icon={Cable} title="Đang tải sơ đồ thiết bị…" />;
  if (!rows.length) {
    return <EmptyState icon={Cable} title="Trạm chưa có sơ đồ kỹ thuật"
      hint="Chưa có thiết bị nào trong sld_node cho trạm này." />;
  }

  return (
    <ReactFlow
      nodes={nodes} edges={spec?.edges ?? []} nodeTypes={nodeTypes}
      fitView fitViewOptions={{ padding: 0.15 }}
      nodesConnectable={false} edgesFocusable={false}
      proOptions={{ hideAttribution: true }}
    >
      {/* ELK layout chạy bất đồng bộ -> node có SAU fitView đầu; refit khi node đổi. */}
      <FitOnChange count={nodes.length} />
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

/** Gọi lại fitView mỗi khi số node thay đổi (sau khi ELK layout xong hoặc bảng đổi). */
function FitOnChange({ count }: { count: number }) {
  const rf = useReactFlow();
  useEffect(() => {
    if (count <= 0) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.15 }), 30);
    return () => clearTimeout(t);
  }, [count, rf]);
  return null;
}
