/**
 * Bảng khách hàng — một tab của màn hình Danh mục.
 *
 * Khách hàng là danh mục PHẲNG (không có quan hệ cha con như KCN → trạm → điểm
 * đo) nên bảng thường là đủ, không cần bố cục nhiều dải.
 */
import { useState, useMemo } from 'react';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';
import CatalogForm from './CatalogForm';
import { isWarehouseCustomer, type WhData } from '../../lib/v2/wh';
import {
  canWrite, whyCannotWrite, deleteBlockers, deleteRecord, readableError, isValidTat,
} from '../../lib/v2/whWrite';
import { toast as notify } from '../../lib/toast';

export default function CustomersPanel({
  data, loading, reload,
}: { data: WhData; loading: boolean; reload: () => void }) {
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<{ record: any | null } | null>(null);
  const [confirming, setConfirming] = useState<{ record: any; blockers: string[] } | null>(null);
  const writable = canWrite();

  const pointCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of data.points) {
      if (!p.customer) continue;
      c.set(p.customer, (c.get(p.customer) ?? 0) + 1);
    }
    return c;
  }, [data.points]);

  /** Tên tắt phải viết liền không dấu vì nó đi thẳng vào mã trạm. */
  const soTatSai = useMemo(
    () => data.customers.filter(c => (c.tat || '').trim() && !isValidTat(c.tat as string)).length,
    [data.customers],
  );

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return data.customers.filter(c =>
      !t || `${c.mkh} ${c.ten} ${c.tat ?? ''}`.toLowerCase().includes(t));
  }, [data.customers, term]);

  const ask = async (record: any) => {
    try {
      setConfirming({ record, blockers: await deleteBlockers('customer', record.id, record) });
    } catch (e) { notify.error(readableError(e)); }
  };

  const doDelete = async () => {
    if (!confirming) return;
    try {
      await deleteRecord('customer', confirming.record.id);
      notify.success('Đã xoá khách hàng');
      setConfirming(null);
      reload();
    } catch (e) { notify.error(readableError(e)); }
  };

  return (
    <div className="space-y-3">
      <div className="vl-card p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={term} onChange={e => setTerm(e.target.value)}
            placeholder="Tìm mã khách hàng, tên..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
          />
        </div>
        <span className="text-[12px] text-faint tnum">{rows.length}/{data.customers.length}</span>
        {soTatSai > 0 && (
          <span className="text-[12px] text-bad">{soTatSai} tên tắt còn dấu hoặc khoảng trắng</span>
        )}
        <button onClick={() => setEditing({ record: null })} disabled={!writable}
          title={writable ? '' : whyCannotWrite()}
          className="px-3 py-2 rounded-lg bg-accent text-[var(--on-accent)] text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
          <Plus className="w-4 h-4" /> Thêm khách hàng
        </button>
      </div>

      <div className="vl-card overflow-x-auto">
        <table className="vl-table w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left">MKH</th>
              <th className="text-left">Tên khách hàng</th>
              <th className="text-left">KCN</th>
              <th className="text-left">Tên tắt</th>
              <th className="text-left">Trạng thái</th>
              <th className="text-left">Ghi chú</th>
              <th className="text-right">Điểm đo</th>
              <th className="w-[90px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.mkh}</td>
                <td>
                  {c.ten}
                  {isWarehouseCustomer(c.mkh) && (
                    <span className="vl-badge-info px-1.5 py-0.5 rounded-md text-[11px] ml-1.5">kho</span>
                  )}
                </td>
                <td className="text-dim">{c.zone || '—'}</td>
                <td>
                  {c.tat
                    ? (isValidTat(c.tat)
                        ? <span className="tnum">{c.tat}</span>
                        : <span className="inline-flex items-center gap-1.5">
                            <span>{c.tat}</span>
                            <span className="vl-badge-danger px-1.5 py-0.5 rounded-md text-[11px]">có dấu</span>
                          </span>)
                    : <span className="text-faint">—</span>}
                </td>
                <td className="text-dim">{c.trang_thai || '—'}</td>
                <td className="text-dim">{c.note || '—'}</td>
                <td className="text-right tnum">{pointCount.get(c.id) ?? 0}</td>
                <td>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setEditing({ record: c })} disabled={!writable}
                      className="p-1.5 rounded-md hover:bg-subtle text-dim disabled:opacity-40" aria-label="Sửa">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => ask(c)} disabled={!writable}
                      className="p-1.5 rounded-md hover:bg-subtle text-bad disabled:opacity-40" aria-label="Xoá">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="py-10 text-center text-faint">
                {loading ? 'Đang tải...' : 'Không có khách hàng nào khớp'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <CatalogForm
          kind="customer" record={editing.record} data={data}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); notify.success(msg); reload(); }}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="vl-card vl-drawer w-full max-w-[440px] p-5 space-y-3">
            <h3 className="text-[16px] font-semibold">Xoá khách hàng?</h3>
            <p className="text-[13px] text-dim">{confirming.record.mkh} — {confirming.record.ten}</p>
            {confirming.blockers.length > 0 && (
              <div className="vl-alert vl-alert-light-danger text-[13px]">
                <p className="font-medium mb-1">Không xoá được:</p>
                {confirming.blockers.map((b, i) => <p key={i}>• {b}</p>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="px-4 py-2 rounded-lg border border-hair text-[13px]">Huỷ</button>
              <button onClick={doDelete} disabled={confirming.blockers.length > 0}
                className="px-4 py-2 rounded-lg bg-[var(--danger)] text-white text-[13px] font-semibold disabled:opacity-40">
                Xoá
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
