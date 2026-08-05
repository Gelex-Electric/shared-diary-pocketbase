import { useState, useMemo } from 'react';
import { Save, Undo2, AlertTriangle, User } from 'lucide-react';
import { toast as notify } from '../../lib/toast';
import type { CatalogData, Point } from '../../lib/catalog';
import { KCN_COLOR } from '../../lib/kcnColors';
import { assignCustomer, currentPeriodOf } from '../../lib/pointCustomer';
import { Select } from '../ui/Select';

/**
 * Bảng gắn khách hàng vào điểm đo (user chốt 05/08).
 *
 * Chỉ hỏi "điểm đo này của khách nào" — KHÔNG bắt nhập kỳ. Nhưng dưới nền vẫn
 * ghi theo kỳ: đổi khách thì đóng kỳ cũ, mở kỳ mới (xem `lib/pointCustomer.ts`).
 * Nhờ vậy 98 kỳ đã seed từ hóa đơn không bị mất.
 *
 * Sửa nhiều dòng rồi bấm Lưu một lần, giống các bảng khác trong trang.
 */
export default function CustomerAssignTable({
  data, editable, onSaved,
}: { data: CatalogData; editable: boolean; onSaved: () => void }) {
  /** pointId -> customerId đang chờ lưu ('' = gỡ khách) */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState('');

  const curOf = (pointId: string) => currentPeriodOf(data.periods, pointId)?.customer ?? '';
  const valOf = (pointId: string) => (pointId in draft ? draft[pointId] : curOf(pointId));
  const dirtyIds = Object.keys(draft).filter(id => draft[id] !== curOf(id));

  const byZone = useMemo(() => {
    const t = term.trim().toLowerCase();
    const match = (p: Point) => {
      if (!t) return true;
      const cus = data.customers.find(c => c.id === valOf(p.id));
      return `${p.line_name} ${cus?.mkh ?? ''} ${cus?.name ?? ''}`.toLowerCase().includes(t);
    };
    return data.zones.map(z => ({
      zone: z,
      points: data.points.filter(p => p.zone === z.id && match(p)),
    })).filter(g => g.points.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, term, draft]);

  const saveAll = async () => {
    if (dirtyIds.length === 0) return;
    setBusy(true);
    let ok = 0;
    const failed: Record<string, string> = {};
    for (const pid of dirtyIds) {
      try {
        await assignCustomer(data, pid, draft[pid]);
        ok++;
      } catch (e: any) {
        // Giữ lại dòng lỗi trong draft để người dùng thấy và thử lại
        failed[pid] = draft[pid];
        const name = data.points.find(p => p.id === pid)?.line_name ?? pid;
        notify.show('error', `Không lưu được ${name}`, e?.message || String(e));
      }
    }
    setDraft(failed);
    setBusy(false);
    if (ok > 0) {
      notify.show('success', 'Đã lưu', `${ok} điểm đo`);
      onSaved();
    }
  };

  const cusOptions = (zoneId: string) => [
    { value: '', label: '— chưa gắn —' },
    ...data.customers
      .filter(c => c.zone === zoneId)
      .map(c => ({ value: c.id, label: `${c.mkh} · ${c.name}` })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text" value={term} onChange={e => setTerm(e.target.value)}
          placeholder="Tìm điểm đo, mã khách, tên khách…"
          className="px-3 py-2 border border-[var(--border)] bg-surface rounded text-dim text-sm
            focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-[300px]"
        />
        <span className="flex-1" />
        {editable && dirtyIds.length > 0 && (
          <>
            <button onClick={() => setDraft({})} disabled={busy}
              className="vl-btn vl-btn-secondary vl-btn-sm">
              <Undo2 className="w-4 h-4" />Hoàn tác
            </button>
            <button onClick={saveAll} disabled={busy}
              className="vl-btn vl-btn-success vl-btn-sm">
              <Save className="w-4 h-4" />
              {busy ? 'Đang lưu...' : `Lưu ${dirtyIds.length} điểm đo`}
            </button>
          </>
        )}
      </div>

      {!editable && (
        <p className="text-xs bg-subtle text-soft font-bold px-3 py-2 rounded flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" />Tài khoản vận hành chỉ xem được.
        </p>
      )}

      {byZone.length === 0 ? (
        <p className="py-12 text-center text-faint">Không có điểm đo nào khớp</p>
      ) : byZone.map(({ zone, points }) => {
        const color = KCN_COLOR[zone.name];
        const dirtyHere = points.filter(p => dirtyIds.includes(p.id)).length;
        return (
          <div key={zone.id} className="vl-card overflow-hidden mb-0!">
            {/* Dùng đúng kiểu đầu nhóm của các bảng khác trong trang: nền `bg-accent`,
                dải màu KCN nằm ở chấm nhỏ bên trái. */}
            <div className="bg-accent px-5 py-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[var(--on-accent)] min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color?.dot ?? 'bg-white/60'}`} />
                <div className="min-w-0">
                  <h3 className="text-base font-black tracking-tight leading-tight truncate">{zone.name}</h3>
                  <p className="text-[11px] font-semibold opacity-80">{points.length} điểm đo</p>
                </div>
              </div>
              {dirtyHere > 0 && (
                <span className="text-[11px] font-bold px-2 py-1 rounded bg-amber-100 text-amber-800 shrink-0">
                  {dirtyHere} chưa lưu
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="vl-table vl-table-compact vl-table-grid w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="w-[38%]">Điểm đo</th>
                    <th className="w-[46%]">Khách hàng (MKH)</th>
                    <th className="w-[16%]">Từ ngày</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map(p => {
                    const cur = currentPeriodOf(data.periods, p.id);
                    const v = valOf(p.id);
                    const dirty = p.id in draft && draft[p.id] !== curOf(p.id);
                    return (
                      <tr key={p.id} className={dirty ? 'bg-amber-50/60 dark:bg-amber-500/10' : ''}>
                        <td className="px-2 py-1.5 font-mono text-xs font-bold text-accent truncate"
                          title={p.line_name}>{p.line_name || '—'}</td>
                        <td>
                          {editable ? (
                            <Select
                              value={v}
                              onChange={val => setDraft(d => ({ ...d, [p.id]: val }))}
                              options={cusOptions(zone.id)}
                              placeholder="— chưa gắn —" searchable variant="bare"
                              className={`w-full px-2 py-1.5 rounded-none border-0 text-xs font-bold
                                ${dirty ? 'ring-2 ring-amber-400' : ''}`}
                            />
                          ) : (
                            <span className="px-2 py-1.5 flex items-center gap-1.5 text-dim text-xs">
                              <User className="w-3 h-3 shrink-0" />
                              {data.customers.find(c => c.id === v)?.mkh ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-xs text-faint whitespace-nowrap">
                          {dirty ? 'sẽ mở kỳ mới hôm nay'
                            : cur?.from_date ? cur.from_date.slice(0, 10).split('-').reverse().join('/') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <p className="text-xs text-faint flex items-start gap-1.5">
        <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
        Đổi khách hàng sẽ <strong>đóng kỳ cũ</strong> (tính đến hôm nay) rồi mở kỳ mới,
        không xóa lịch sử. Xem lịch sử đầy đủ ở thẻ chi tiết điểm đo bên trang Sắp xếp.
      </p>
    </div>
  );
}
