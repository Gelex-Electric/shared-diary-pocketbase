import type { CatalogData } from '../../lib/catalog';
import type { ColumnDef, EntityKind } from '../../lib/catalogCrud';
import {
  ZoneTag, RoleTag, PointStatusTag, AssetTypeTag, AssetStatusTag, LocationTag, OverdueTag,
} from './tags';

export type Draft = Record<string, Record<string, any>>;

/**
 * Bảng sửa TRỰC TIẾP kiểu Excel: gõ thẳng vào ô, thay đổi được gom vào
 * `draft` rồi bấm Lưu mới ghi lên PocketBase.
 *
 * Ô đã sửa được tô nền vàng để không ai lưu nhầm thứ mình không định đổi.
 */
export default function EditableTable({
  kind, cols, rows, data, draft, editable, onChange, onDelete, computeCell,
}: {
  kind: EntityKind;
  cols: ColumnDef[];
  rows: any[];
  data: CatalogData;
  draft: Draft;
  editable: boolean;
  onChange: (id: string, key: string, value: any) => void;
  onDelete: (rec: any) => void;
  /** Giá trị cho cột 'readonly' (số đếm, tag dẫn xuất...). */
  computeCell: (rec: any, key: string) => string;
}) {
  const val = (rec: any, key: string) =>
    draft[rec.id] && key in draft[rec.id] ? draft[rec.id][key] : (rec[key] ?? '');

  const dirty = (rec: any, key: string) => {
    if (!draft[rec.id] || !(key in draft[rec.id])) return false;
    const a = draft[rec.id][key] ?? '';
    const b = rec[key] ?? '';
    return String(a) !== String(b);
  };

  const relOptions = (c: ColumnDef) => {
    if (c.relFrom === 'zone') return data.zones.map(z => ({ value: z.id, label: z.code }));
    if (c.relFrom === 'station') return data.stations.map(s => ({ value: s.id, label: s.code }));
    if (c.relFrom === 'warehouse') return data.warehouses.map(w => ({ value: w.id, label: w.code }));
    return [];
  };

  const renderTag = (rec: any, c: ColumnDef) => {
    const v = val(rec, c.key);
    switch (c.tag) {
      case 'zone': return <ZoneTag zoneId={v} data={data} />;
      case 'role': return <RoleTag role={v} />;
      case 'point_status': return <PointStatusTag status={v} />;
      case 'asset_status': return <AssetStatusTag status={v} />;
      case 'asset_type': return <AssetTypeTag asset={{ type: val(rec, 'type'), model_desc: val(rec, 'model_desc') }} />;
      case 'location': return <LocationTag asset={rec} data={data} />;
      default: return null;
    }
  };

  const cellInput = (rec: any, c: ColumnDef) => {
    const v = val(rec, c.key);
    const isDirty = dirty(rec, c.key);
    const bad = c.required && String(v).trim() === '';
    const base = `w-full bg-transparent px-1.5 py-1 rounded text-sm outline-none transition-colors
      ${isDirty ? 'bg-amber-100 dark:bg-amber-500/20 font-semibold' : ''}
      ${bad ? 'ring-1 ring-[var(--danger)]' : 'focus:ring-2 focus:ring-accent focus:bg-surface'}`;

    if (!editable) {
      return c.tag
        ? <div className="px-1.5 py-1">{renderTag(rec, c)}</div>
        : <div className="px-1.5 py-1 text-dim truncate">{String(v || '—')}</div>;
    }

    if (c.kind === 'select' || c.kind === 'rel') {
      const opts = c.kind === 'rel' ? relOptions(c) : (c.options ?? []);
      return (
        <div className="flex items-center gap-1">
          {c.tag && <span className="shrink-0">{renderTag(rec, c)}</span>}
          <select value={v ?? ''} onChange={e => onChange(rec.id, c.key, e.target.value)}
            className={`${base} ${c.tag ? 'w-auto max-w-[7rem] text-xs text-soft' : ''}`}>
            <option value="">—</option>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    }

    return (
      <input
        type={c.kind === 'number' ? 'number' : c.kind === 'date' ? 'date' : 'text'}
        value={v ?? ''}
        onChange={e => onChange(rec.id, c.key, e.target.value)}
        className={base}
      />
    );
  };

  return (
    <div className="vl-card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-subtle text-xs text-soft sticky top-0">
          <tr className="text-left">
            {cols.map(c => (
              <th key={c.key} className={`px-2 py-2 whitespace-nowrap ${c.width ?? ''}`} title={c.hint}>
                {c.label}{c.required && <span className="text-bad"> *</span>}
              </th>
            ))}
            <th className="px-2 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length + 1} className="px-3 py-10 text-center text-faint">Không có dữ liệu</td></tr>
          ) : rows.map(rec => (
            <tr key={rec.id} className={draft[rec.id] ? 'bg-amber-50/40 dark:bg-amber-500/5' : 'hover:bg-subtle transition-colors'}>
              {cols.map(c => (
                <td key={c.key} className={`px-1 py-0.5 ${c.width ?? ''}`}>
                  {c.kind === 'readonly' ? (
                    <div className="px-1.5 py-1 flex items-center gap-1">
                      {c.tag ? renderTag(rec, c) : <span className="text-dim">{computeCell(rec, c.key)}</span>}
                      {kind === 'asset' && c.key === '_location' && <OverdueTag asset={rec} />}
                    </div>
                  ) : cellInput(rec, c)}
                </td>
              ))}
              <td className="px-2 py-0.5 text-right">
                {editable && (
                  <button onClick={() => onDelete(rec)}
                    className="p-1.5 rounded text-soft hover:bg-[var(--danger-soft)] hover:text-bad transition-colors"
                    title="Xóa">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                    </svg>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
