import { Trash2, Pencil } from 'lucide-react';
import { KCN_COLOR } from '../../lib/kcnColors';
import type { CatalogData } from '../../lib/catalog';
import { type ColumnDef, type EntityKind, ratioText } from '../../lib/catalogCrud';
import { Select } from '../ui/Select';
import {
  ZoneTag, RoleTag, PointStatusTag, AssetTypeTag, AssetStatusTag, LocationTag, OverdueTag,
} from './tags';

export type Draft = Record<string, Record<string, any>>;

/**
 * Bảng sửa TRỰC TIẾP kiểu Excel: gõ thẳng vào ô, thay đổi gom vào `draft`,
 * bấm Lưu mới ghi lên PocketBase.
 *
 * Nguyên tắc trình bày (user góp ý 03/08):
 *  - MỖI Ô CHỈ MỘT THỨ: đã có ô chọn thì không hiện thêm tag cùng nội dung.
 *    Ô chọn tự mang màu của giá trị đang chọn.
 *  - Màu KCN nằm ở DẢI ĐẦU DÒNG, không lặp lại trong ô.
 */
export default function EditableTable({
  kind, cols, rows, data, draft, editable, onChange, onDelete, computeCell, onOpenLifecycle,
  onEditRecord, selectedId,
}: {
  kind: EntityKind;
  cols: ColumnDef[];
  rows: any[];
  data: CatalogData;
  draft: Draft;
  editable: boolean;
  onChange: (id: string, key: string, value: any) => void;
  onDelete: (rec: any) => void;
  computeCell: (rec: any, key: string) => string;
  /** Chỉ dùng cho bảng vật tư: mở màn hình vòng đời + sổ cái. */
  onOpenLifecycle?: (rec: any) => void;
  /** Mở form sửa cả bản ghi — nơi duy nhất sửa được mã vật tư. */
  onEditRecord?: (rec: any) => void;
  /** Vật tư đang mở ở ngăn sổ cái — tô sáng dòng cho khỏi lạc. */
  selectedId?: string | null;
}) {

  const val = (rec: any, key: string) => {
    if (draft[rec.id] && key in draft[rec.id]) return draft[rec.id][key];
    if (key === 'ratio_text') return ratioText(rec);
    return rec[key] ?? '';
  };

  const isDirty = (rec: any, key: string) => {
    if (!draft[rec.id] || !(key in draft[rec.id])) return false;
    const a = draft[rec.id][key] ?? '';
    const b = key === 'ratio_text' ? ratioText(rec) : (rec[key] ?? '');
    return String(a) !== String(b);
  };

  /** Dải màu KCN ở đầu dòng — thay cho việc lặp tag KCN trong ô. */
  const zoneStripe = (rec: any): string => {
    const zid = kind === 'zone' ? rec.id : val(rec, 'zone');
    const z = data.zones.find(x => x.id === zid);
    return (z && KCN_COLOR[z.name]?.dot) || 'bg-transparent';
  };

  const relOptions = (c: ColumnDef) => {
    if (c.relFrom === 'zone') return data.zones.map(z => ({ value: z.id, label: z.code }));
    if (c.relFrom === 'station') return data.stations.map(s => ({ value: s.id, label: s.code }));
    if (c.relFrom === 'warehouse') return data.warehouses.map(w => ({ value: w.id, label: w.code }));
    return [];
  };

  /** Tag chỉ dùng cho ô KHÔNG sửa được, hoặc khi tài khoản chỉ có quyền xem. */
  const readTag = (rec: any, c: ColumnDef) => {
    const v = val(rec, c.key);
    switch (c.tag) {
      case 'zone': return <ZoneTag zoneId={v} data={data} />;
      case 'role': return <RoleTag role={v} />;
      case 'point_status': return <PointStatusTag status={v} />;
      case 'asset_status': return <AssetStatusTag status={v} />;
      case 'asset_type': return <AssetTypeTag asset={{ type: v }} />;
      case 'location': return <LocationTag asset={rec} data={data} />;
      default: return <span className="text-dim">{String(v || '—')}</span>;
    }
  };

  /** Màu nền cho ô chọn, để select trông như tag mà vẫn là một điều khiển duy nhất. */
  const selectTone = (c: ColumnDef, v: string): string => {
    if (!c.tag) return 'bg-surface border-[var(--border)]';
    if (c.tag === 'role') {
      return v === 'chinh'
        ? 'bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/40 font-bold'
        : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40';
    }
    if (c.tag === 'point_status') {
      return v === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40'
        : v === 'dismounted' ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40 font-bold'
        : v === 'du_kien' ? 'bg-sky-50 text-sky-700 border-sky-300 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40'
        : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40';
    }
    if (c.tag === 'asset_status') {
      return v === 'dang_treo' || v === 'dat' ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/40'
        : v === 'khong_dat' ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/40'
        : v === 'thanh_ly' ? 'bg-zinc-200 text-zinc-600 border-zinc-400 dark:bg-zinc-500/25 dark:text-zinc-400 dark:border-zinc-500/40'
        : v.includes('kiem_dinh') ? 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40'
        : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40';
    }
    if (c.tag === 'asset_type') {
      return v === 'ME41' ? 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/40'
        : v === 'ME42' ? 'bg-cyan-50 text-cyan-700 border-cyan-300 dark:bg-cyan-500/15 dark:text-cyan-300 dark:border-cyan-500/40'
        : v === 'DTS27' ? 'bg-indigo-50 text-indigo-700 border-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/40'
        : v === 'TI' ? 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40'
        : v === 'TU' ? 'bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40'
        : v === 'SIM' ? 'bg-lime-50 text-lime-700 border-lime-300 dark:bg-lime-500/15 dark:text-lime-300 dark:border-lime-500/40'
        : v === 'GP03' ? 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/40'
        : 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/40';
    }
    return 'bg-surface border-[var(--border)]';
  };

  const cell = (rec: any, c: ColumnDef) => {
    const v = val(rec, c.key);
    const dirty = isDirty(rec, c.key);

    // Mã vật tư KHÔNG gõ trực tiếp: bấm vào là mở sổ cái vòng đời (user chốt
    // 05/08). Sửa mã sai thì qua nút bút chì -> RecordForm, tránh việc một ô
    // vừa mở ngăn vừa nhận phím gõ.
    if (kind === 'asset' && c.key === 'serial' && onOpenLifecycle) {
      return (
        <button onClick={() => onOpenLifecycle(rec)}
          className="w-full text-left px-2 py-1.5 font-mono text-sm font-bold text-accent
            hover:bg-accent-soft hover:underline transition-colors truncate"
          title="Xem lịch sử luân chuyển & vị trí hiện tại">
          {String(v || '—')}
        </button>
      );
    }

    if (c.kind === 'readonly') {
      // Cột tính toán (_stations/_points/_assets): bản ghi KHÔNG có trường tên đó
      // nên trước đây readTag trả '—' rồi vẽ thêm số ⇒ hiện thành "—22".
      // Giờ: có tag thì vẽ tag, không thì CHỈ vẽ giá trị tính được.
      return (
        <div className="px-2 py-1.5 flex items-center gap-1.5">
          {c.tag ? readTag(rec, c) : <span className="text-dim">{computeCell(rec, c.key) || '—'}</span>}
          {kind === 'asset' && c.key === '_location' && <OverdueTag asset={rec} />}
        </div>
      );
    }

    if (!editable) return <div className="px-2 py-1.5">{readTag(rec, c)}</div>;

    const bad = c.required && String(v).trim() === '';
    const ring = dirty ? 'ring-2 ring-amber-400 dark:ring-amber-500' : bad ? 'ring-1 ring-[var(--danger)]' : '';

    if (c.kind === 'select' || c.kind === 'rel') {
      const opts = c.kind === 'rel' ? relOptions(c) : (c.options ?? []);
      // Dùng <Select> của app (có ô tìm kiếm khi danh sách dài).
      // variant="bare" để khung ngoài mang MÀU theo giá trị đang chọn.
      return (
        <Select
          value={String(v ?? '')}
          onChange={val => onChange(rec.id, c.key, val)}
          options={opts}
          placeholder="—"
          searchable={opts.length > 8}
          variant="bare"
          className={`w-full px-2 py-1.5 rounded-none border-0 text-xs font-bold cursor-pointer
            ${selectTone(c, String(v))} ${ring}`}
        />
      );
    }

    return (
      <input
        type={c.kind === 'number' ? 'number' : c.kind === 'date' ? 'date' : 'text'}
        value={v ?? ''}
        onChange={e => onChange(rec.id, c.key, e.target.value)}
        placeholder={c.key === 'ratio_text' ? '2000/5' : ''}
        className={`w-full bg-transparent px-2 py-1.5 rounded-none border-0 text-sm outline-none
          focus:bg-accent-soft
          ${dirty ? 'bg-amber-100 dark:bg-amber-500/20 font-semibold' : ''} ${ring}`}
      />
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="vl-table vl-table-compact vl-table-grid w-full text-left border-collapse">
        <thead>
          <tr>
            <th className="w-1 p-0!" />
            {cols.map(c => (
              <th key={c.key} className={`whitespace-nowrap ${c.width ?? ''}`} title={c.hint}>
                {c.label}{c.required && <span className="text-bad"> *</span>}
              </th>
            ))}
            <th className="w-16" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length + 2} className="py-12 text-center text-faint">Không có dữ liệu</td></tr>
          ) : rows.map((rec, i) => (
            <tr key={rec.id} className={`transition-colors ${
              selectedId === rec.id ? 'bg-accent-soft'
                : draft[rec.id] ? 'bg-amber-50/60 dark:bg-amber-500/10'
                : i % 2 ? 'bg-subtle/40' : ''
            }`}>
              {/* Dải màu KCN đầu dòng */}
              <td className="w-1 p-0!"><div className={`w-1 h-full min-h-[2.1rem] ${zoneStripe(rec)}`} /></td>

              {cols.map(c => (
                <td key={c.key} className={`align-middle ${c.width ?? ''}`}>{cell(rec, c)}</td>
              ))}

              <td className="text-right whitespace-nowrap px-1 py-1">
                {editable && onEditRecord && (
                  <button onClick={() => onEditRecord(rec)}
                    className="p-1.5 rounded text-faint hover:bg-accent-soft hover:text-accent transition-colors"
                    title="Sửa cả bản ghi">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {editable && (
                  <button onClick={() => onDelete(rec)}
                    className="p-1.5 rounded text-faint hover:bg-[var(--danger-soft)] hover:text-bad transition-colors"
                    title="Xóa">
                    <Trash2 className="w-3.5 h-3.5" />
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
