/**
 * Màn hình KHÁCH HÀNG & KHO.
 *
 * Thiết bị đã gộp vào "Vật tư trong kho"; KCN, trạm và điểm đo đã chuyển sang
 * màn hình "Đơn vị & điểm đo" dạng ba dải (user chốt 07/08). Còn lại hai danh
 * mục phẳng, không có quan hệ cha con nên bảng thường là đủ.
 *
 * Cũng chỉ làm phần khai báo. Biến động hằng ngày (nhập kho, điều chuyển, treo,
 * tháo, kiểm định, thanh lý) thuộc màn hình khác — gộp vào đây thì cùng một
 * việc sẽ có hai đường ghi khác nhau, và sổ nhật ký sẽ lệch.
 */
import { useState, useMemo } from 'react';
import { Plus, Search, RefreshCw, Pencil, Trash2, Lock, Users, Warehouse } from 'lucide-react';
import { useWhData, ErrorBar } from './shared';
import { Tabs, type TabItem } from '../ui/Tabs';
import CatalogForm from './CatalogForm';
import {
  canWrite, whyCannotWrite, deleteBlockers, deleteRecord, readableError,
  ENTITY_LABEL, type EntityKind,
} from '../../lib/v2/whWrite';
import { toast as notify } from '../../lib/toast';

const KIND_TABS: TabItem<EntityKind>[] = [
  { id: 'customer', label: 'Khách hàng', icon: Users },
  { id: 'warehouse', label: 'Kho', icon: Warehouse },
];

export default function CatalogScreen() {
  const { data, loading, error, reload } = useWhData();
  const [kind, setKind] = useState<EntityKind>('customer');
  const [term, setTerm] = useState('');
  const [editing, setEditing] = useState<{ record: Record<string, any> | null } | null>(null);
  const [confirming, setConfirming] = useState<{ record: any; blockers: string[] } | null>(null);
  const writable = canWrite();

  const rows: any[] = useMemo(() => {
    const t = term.trim().toLowerCase();
    const hit = (s: string) => !t || s.toLowerCase().includes(t);
    switch (kind) {
      case 'customer': return data.customers.filter(c => hit(`${c.mkh} ${c.ten} ${c.tat ?? ''}`));
      case 'warehouse': return data.warehouses.filter(w => hit(`${w.code} ${w.name}`));
      default: return [];
    }
  }, [kind, data, term]);

  const askDelete = async (record: any) => {
    try {
      setConfirming({ record, blockers: await deleteBlockers(kind, record.id) });
    } catch (e) {
      notify.error(readableError(e));
    }
  };

  const doDelete = async () => {
    if (!confirming) return;
    try {
      await deleteRecord(kind, confirming.record.id);
      notify.success('Đã xoá');
      setConfirming(null);
      reload();
    } catch (e) {
      notify.error(readableError(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="vl-card p-3 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[15px] font-semibold">Khách hàng &amp; kho</h2>
          <p className="text-[12px] text-faint">
            Khách hàng và kho — KCN, trạm, điểm đo ở mục Đơn vị & điểm đo
          </p>
        </div>
        <button onClick={reload} disabled={loading}
          className="px-3 py-2 rounded-lg border border-hair text-[13px] flex items-center gap-1.5 disabled:opacity-60">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Tải lại
        </button>
        <button
          onClick={() => setEditing({ record: null })} disabled={!writable}
          title={writable ? '' : whyCannotWrite()}
          className="px-3 py-2 rounded-lg bg-accent text-[var(--on-accent)] text-[13px] font-semibold flex items-center gap-1.5 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Thêm {ENTITY_LABEL[kind].toLowerCase()}
        </button>
      </div>

      <ErrorBar message={error} />

      {!writable && (
        <div className="vl-alert vl-alert-light-warning flex items-center gap-2 text-[13px]">
          <Lock className="w-4 h-4 shrink-0" /> {whyCannotWrite()}
        </div>
      )}

      <div className="vl-card p-3 flex flex-wrap items-center gap-2">
        <div className="flex-1">
          <Tabs tabs={KIND_TABS} value={kind} onChange={k => { setKind(k); setTerm(''); }} />
        </div>
        <div className="relative min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            value={term} onChange={e => setTerm(e.target.value)}
            placeholder="Tìm..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
          />
        </div>
      </div>

      <div className="vl-card overflow-x-auto">
        <table className="vl-table w-full text-[13px]">
          <thead>
            <tr>
              {kind === 'customer' && <><th className="text-left">Mã KH</th><th className="text-left">Tên</th><th className="text-left">KCN</th><th className="text-left">Trạng thái</th></>}
              {kind === 'warehouse' && <><th className="text-left">Mã kho</th><th className="text-left">Tên kho</th><th className="text-left">KCN</th><th className="text-left">Còn dùng</th></>}
              <th className="w-[90px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                {kind === 'customer' && <>
                  <td className="font-medium">{r.mkh}</td><td>{r.ten}</td>
                  <td className="text-dim">{r.zone || '—'}</td><td className="text-dim">{r.trang_thai || '—'}</td>
                </>}
                {kind === 'warehouse' && <>
                  <td className="font-medium">{r.code}</td><td>{r.name}</td>
                  <td className="text-dim">{r.zone || <span className="text-faint">kho trung chuyển</span>}</td>
                  <td className="text-dim">{r.active ? 'có' : 'không'}</td>
                </>}
                <td>
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setEditing({ record: r })} disabled={!writable}
                      className="p-1.5 rounded-md hover:bg-subtle text-dim disabled:opacity-40" aria-label="Sửa">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => askDelete(r)} disabled={!writable}
                      className="p-1.5 rounded-md hover:bg-subtle text-bad disabled:opacity-40" aria-label="Xoá">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={5} className="py-10 text-center text-faint">
                {loading ? 'Đang tải...' : `Chưa có ${ENTITY_LABEL[kind].toLowerCase()} nào`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <CatalogForm
          kind={kind} record={editing.record} data={data}
          onClose={() => setEditing(null)}
          onSaved={msg => { setEditing(null); notify.success(msg); reload(); }}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="vl-card vl-drawer w-full max-w-[440px] p-5 space-y-3">
            <h3 className="text-[16px] font-semibold">Xoá {ENTITY_LABEL[kind].toLowerCase()}?</h3>
            <p className="text-[13px] text-dim">
              {confirming.record.serial ?? confirming.record.point_code ?? confirming.record.mkh ?? confirming.record.code}
            </p>
            {confirming.blockers.length > 0 && (
              <div className="vl-alert vl-alert-light-danger text-[13px]">
                <p className="font-medium mb-1">Không xoá được:</p>
                {confirming.blockers.map((b, i) => <p key={i}>• {b}</p>)}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirming(null)} className="px-4 py-2 rounded-lg border border-hair text-[13px]">
                Huỷ
              </button>
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
