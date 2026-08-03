import { useState, useMemo } from 'react';
import { Warehouse, Search, AlertTriangle, PackageOpen } from 'lucide-react';
import {
  type CatalogData, type Asset, ASSET_TYPE_LABEL, isOverdue,
} from '../../lib/catalog';
import type { DragItem } from '../../lib/dnd';
import { Draggable, Droppable } from './dndParts';

const TYPES = ['CONGTO', 'TI', 'TU', 'GP03', 'KHAC'] as const;

/** Ngăn kho: vật tư đang trong kho (kéo lên điểm đo) + là vùng thả để tháo về. */
export default function WarehousePanel({
  data, active, canEditNow,
}: { data: CatalogData; active: DragItem | null; canEditNow: boolean }) {
  const [term, setTerm] = useState('');
  const [type, setType] = useState<string>('');

  const inStock = useMemo(() => {
    const t = term.trim().toLowerCase();
    return data.assets.filter(a =>
      (a.current_status === 'kho' || a.current_status === 'dat')
      && (!type || a.type === type)
      && (!t || a.serial.toLowerCase().includes(t)),
    );
  }, [data.assets, term, type]);

  const byWarehouse = useMemo(() => {
    const m = new Map<string, Asset[]>();
    for (const a of inStock) {
      const k = a.current_warehouse || '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return m;
  }, [inStock]);

  const countByType = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of data.assets) {
      if (a.current_status === 'kho' || a.current_status === 'dat') c[a.type] = (c[a.type] ?? 0) + 1;
    }
    return c;
  }, [data.assets]);

  const AssetChip = ({ a }: { a: Asset }) => {
    const overdue = isOverdue(a);
    return (
      <Draggable item={{ kind: 'asset', id: a.id }} disabled={!canEditNow}>
        <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm border ${
          overdue ? 'border-[var(--danger)]/40 bg-[var(--danger-soft)]' : 'border-[var(--border)]'
        }`}>
          <span className="font-mono text-xs font-bold text-accent shrink-0">{a.serial}</span>
          <span className="text-[0.7rem] text-faint shrink-0">{ASSET_TYPE_LABEL[a.type]}</span>
          {a.ratio ? <span className="text-[0.7rem] text-soft shrink-0">tỷ số {a.ratio}</span> : null}
          <span className="flex-1" />
          {overdue && (
            <span className="text-[0.65rem] font-bold text-bad flex items-center gap-1 shrink-0" title={`Hạn kiểm định ${a.next_calibration?.slice(0, 10)}`}>
              <AlertTriangle className="w-3 h-3" />quá hạn
            </span>
          )}
        </div>
      </Draggable>
    );
  };

  return (
    <div className="vl-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Warehouse className="w-4 h-4 text-accent" />
        <h3 className="font-bold text-ink flex-1">Kho vật tư</h3>
        <span className="text-xs text-faint">{inStock.length} món</span>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setType('')}
          className={`text-[0.7rem] font-bold px-2 py-1 rounded ${!type ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-soft'}`}
        >
          Tất cả
        </button>
        {TYPES.map(t => (
          <button
            key={t} onClick={() => setType(t === type ? '' : t)}
            className={`text-[0.7rem] font-bold px-2 py-1 rounded ${type === t ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-soft'}`}
          >
            {ASSET_TYPE_LABEL[t]} {countByType[t] ?? 0}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" />
        <input
          value={term} onChange={e => setTerm(e.target.value)} placeholder="Tìm số hiệu..."
          className="w-full pl-8 pr-3 py-1.5 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none"
        />
      </div>

      <div className="space-y-3 max-h-[60vh] overflow-y-auto">
        {data.warehouses.map(w => {
          const items = byWarehouse.get(w.id) ?? [];
          return (
            <Droppable
              key={w.id} target={{ kind: 'warehouse', id: w.id }}
              active={active} data={data} className="border border-[var(--border)] rounded p-2"
            >
              <p className="text-xs font-bold text-soft mb-2">{w.name} <span className="text-faint">({items.length})</span></p>
              <div className="space-y-1">
                {items.length === 0
                  ? <p className="text-[0.7rem] text-faint py-1">Kho trống — kéo vật tư từ điểm đo về đây để tháo.</p>
                  : items.map(a => <AssetChip key={a.id} a={a} />)}
              </div>
            </Droppable>
          );
        })}

        {/* Vật tư trong kho nhưng chưa gán kho nào */}
        {(byWarehouse.get('') ?? []).length > 0 && (
          <div className="border border-dashed border-[var(--border)] rounded p-2">
            <p className="text-xs font-bold text-warn mb-2 flex items-center gap-1">
              <PackageOpen className="w-3.5 h-3.5" />
              Chưa rõ kho ({(byWarehouse.get('') ?? []).length})
            </p>
            <div className="space-y-1">
              {(byWarehouse.get('') ?? []).map(a => <AssetChip key={a.id} a={a} />)}
            </div>
          </div>
        )}
      </div>

      {data.assets.filter(a => a.type !== 'CONGTO').length === 0 && (
        <p className="text-[0.7rem] text-faint border-t border-[var(--border)] pt-2">
          Chưa có TI / TU / GP-03 nào. Không nguồn dữ liệu nào có sẵn — phải nhập tay.
        </p>
      )}
    </div>
  );
}
