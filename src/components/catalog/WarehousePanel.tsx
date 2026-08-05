import { useState, useMemo } from 'react';
import { Warehouse, Search, AlertTriangle, Upload } from 'lucide-react';
import {
  type CatalogData, type Asset, ASSET_TYPE_LABEL, ASSET_TYPES, isOverdue, isMeter,
} from '../../lib/catalog';
import BulkImportAssets from './BulkImportAssets';



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

  /**
   * CHỈ vật tư được nhập về ĐÚNG KHO của KCN này (user chốt 03/08).
   * Vật tư chưa gán kho đếm riêng bên dưới để không bị mất dấu.
   */
  const inStock = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!warehouse) return [];
    return data.assets.filter(a => {
      if (a.current_status !== 'kho' && a.current_status !== 'dat') return false;
      if (a.current_warehouse !== warehouse.id) return false;
      if (type && a.type !== type) return false;
      if (t && !a.serial.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [data.assets, warehouse, term, type]);

  /** Vật tư trong kho nhưng chưa biết thuộc kho nào — cần gán. */
  const noWarehouse = useMemo(
    () => data.assets.filter(a =>
      (a.current_status === 'kho' || a.current_status === 'dat') && !a.current_warehouse),
    [data.assets],
  );

  const countByType = useMemo(() => {
    const c: Record<string, number> = {};
    if (!warehouse) return c;
    for (const a of data.assets) {
      if (a.current_status !== 'kho' && a.current_status !== 'dat') continue;
      if (a.current_warehouse !== warehouse.id) continue;
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
            className="vl-btn vl-btn-secondary vl-btn-sm"
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

      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-[var(--border)] bg-subtle p-1">
        <button onClick={() => setType('')}
          className={`text-[0.7rem] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
            !type ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-soft hover:text-dim'
          }`}>
          Tất cả
        </button>
        {ASSET_TYPES.map(t => (
          <button key={t} onClick={() => setType(t === type ? '' : t)}
            className={`text-[0.7rem] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
              type === t ? 'bg-surface text-accent shadow-[var(--shadow-card)]' : 'text-soft hover:text-dim'
            }`}>
            {ASSET_TYPE_LABEL[t]} <span className="opacity-70">{countByType[t] ?? 0}</span>
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
          ? <p className="text-[0.7rem] text-faint py-2">Kho này chưa có vật tư nào.</p>
          : inStock.map(a => <AssetRow key={a.id} a={a} />)}
      </div>

      {noWarehouse.length > 0 && (
        <p className="text-[0.7rem] text-warn border-t border-[var(--border)] pt-2 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {noWarehouse.length} vật từ chưa gán kho nào — sửa ở trang <strong>Quản lý danh mục</strong> để chúng hiện ở đây.
        </p>
      )}

      {data.assets.filter(a => !isMeter(a.type)).length === 0 && (
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
