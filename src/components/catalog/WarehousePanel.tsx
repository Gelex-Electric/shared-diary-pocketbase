import { useState, useMemo } from 'react';
import { Warehouse, Search, AlertTriangle, Upload } from 'lucide-react';
import {
  type CatalogData, type Asset, ASSET_TYPE_LABEL, isOverdue,
} from '../../lib/catalog';
import BulkImportAssets from './BulkImportAssets';

const TYPES = ['CONGTO', 'TI', 'TU', 'GP03', 'KHAC'] as const;

/**
 * Ngăn kho của MỘT khu công nghiệp (mỗi KCN đúng 1 kho — user chốt 03/08).
 * Tích chọn vật tư ở đây rồi dùng thanh thao tác dưới màn hình để treo.
 */
export default function WarehousePanel({
  data, zoneId, canEditNow, picked, onPick, onImported,
}: {
  data: CatalogData;
  zoneId: string;
  canEditNow: boolean;
  picked: Set<string>;
  onPick: (s: Set<string>) => void;
  onImported?: () => void;
}) {
  const [term, setTerm] = useState('');
  const [type, setType] = useState<string>('');
  const [bulkOpen, setBulkOpen] = useState(false);

  const warehouse = data.warehouses.find(w => w.zone === zoneId);

  /** Vật tư trong kho của KCN này + vật tư chưa gán kho nào (để không bị mất dấu). */
  const inStock = useMemo(() => {
    const t = term.trim().toLowerCase();
    return data.assets.filter(a => {
      if (a.current_status !== 'kho' && a.current_status !== 'dat') return false;
      const mine = warehouse ? a.current_warehouse === warehouse.id : false;
      if (!mine && a.current_warehouse) return false;   // thuộc kho KCN khác
      if (type && a.type !== type) return false;
      if (t && !a.serial.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [data.assets, warehouse, term, type]);

  const countByType = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of data.assets) {
      if (a.current_status !== 'kho' && a.current_status !== 'dat') continue;
      const mine = warehouse ? a.current_warehouse === warehouse.id : false;
      if (!mine && a.current_warehouse) continue;
      c[a.type] = (c[a.type] ?? 0) + 1;
    }
    return c;
  }, [data.assets, warehouse]);

  const toggle = (id: string) => {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id); else n.add(id);
    onPick(n);
  };

  const AssetRow = ({ a }: { a: Asset }) => {
    const overdue = isOverdue(a);
    const orphanWarehouse = !a.current_warehouse;
    return (
      <label className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm border cursor-pointer transition-colors ${
        picked.has(a.id) ? 'border-accent bg-accent-soft'
          : overdue ? 'border-[var(--danger)]/40 bg-[var(--danger-soft)]'
          : 'border-[var(--border)] hover:bg-subtle'
      }`}>
        <input type="checkbox" disabled={!canEditNow} checked={picked.has(a.id)}
          onChange={() => toggle(a.id)} className="w-3.5 h-3.5 shrink-0" />
        <span className="font-mono text-xs font-bold text-accent shrink-0">{a.serial}</span>
        <span className="text-[0.7rem] text-faint shrink-0">{ASSET_TYPE_LABEL[a.type]}</span>
        {a.ratio ? <span className="text-[0.7rem] text-soft shrink-0">tỷ số {a.ratio}</span> : null}
        <span className="flex-1" />
        {orphanWarehouse && (
          <span className="text-[0.65rem] text-warn shrink-0" title="Chưa gán kho nào">chưa rõ kho</span>
        )}
        {overdue && (
          <span className="text-[0.65rem] font-bold text-bad flex items-center gap-1 shrink-0"
            title={`Hạn kiểm định ${a.next_calibration?.slice(0, 10)} — không treo lên điểm đo được`}>
            <AlertTriangle className="w-3 h-3" />quá hạn
          </span>
        )}
      </label>
    );
  };

  return (
    <div className="vl-card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Warehouse className="w-4 h-4 text-accent" />
        <h3 className="font-bold text-ink flex-1">{warehouse?.name ?? 'Kho vật tư'}</h3>
        <span className="text-xs text-faint">{inStock.length} món</span>
        {canEditNow && (
          <button onClick={() => setBulkOpen(true)}
            className="flex items-center gap-1 text-xs font-bold px-2 py-1 rounded border border-[var(--border)] text-soft hover:bg-subtle transition-colors"
            title="Dán danh sách vật tư từ Excel">
            <Upload className="w-3.5 h-3.5" />Nhập hàng loạt
          </button>
        )}
      </div>

      {!warehouse && (
        <p className="text-xs text-warn flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Khu công nghiệp này chưa có kho — không tháo vật tư về được.
        </p>
      )}

      <div className="flex flex-wrap gap-1">
        <button onClick={() => setType('')}
          className={`text-[0.7rem] font-bold px-2 py-1 rounded ${!type ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-soft'}`}>
          Tất cả
        </button>
        {TYPES.map(t => (
          <button key={t} onClick={() => setType(t === type ? '' : t)}
            className={`text-[0.7rem] font-bold px-2 py-1 rounded ${type === t ? 'bg-accent text-[var(--on-accent)]' : 'bg-subtle text-soft'}`}>
            {ASSET_TYPE_LABEL[t]} {countByType[t] ?? 0}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-faint" />
        <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Tìm số hiệu..."
          className="w-full pl-8 pr-3 py-1.5 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none" />
      </div>

      <div className="space-y-1 max-h-[40vh] overflow-y-auto">
        {inStock.length === 0
          ? <p className="text-[0.7rem] text-faint py-2">Kho trống.</p>
          : inStock.map(a => <AssetRow key={a.id} a={a} />)}
      </div>

      {data.assets.filter(a => a.type !== 'CONGTO').length === 0 && (
        <p className="text-[0.7rem] text-faint border-t border-[var(--border)] pt-2">
          Chưa có TI / TU / GP-03 nào — dùng "Nhập hàng loạt" để dán từ Excel.
        </p>
      )}

      {bulkOpen && (
        <BulkImportAssets data={data} onClose={() => setBulkOpen(false)}
          onDone={() => { onImported?.(); }} />
      )}
    </div>
  );
}
