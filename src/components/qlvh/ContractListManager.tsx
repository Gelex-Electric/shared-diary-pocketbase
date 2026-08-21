/**
 * Màn hình danh sách hợp đồng quản lý vận hành (QLVH) — GIAI ĐOẠN 1: CHỈ ĐỌC.
 *
 * Một component cho cả hai khối, phân biệt bằng prop `scope` (nguyên tắc 17):
 *  - 'vanphong' : thấy toàn bộ KCN, chọn được KCN.
 *  - 'doi'      : chỉ KCN của tài khoản.
 *
 * Thêm/sửa hợp đồng và ghi nhận thu tiền làm ở Task 4–5.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CalendarClock, ChevronRight, FileText, Pencil, Plus,
  RefreshCw, Search, Trash2, Wallet,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { StatTile, EmptyState } from '../ui/dashboard';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast as notify } from '../../lib/toast';
import { useScopeAreas, type Scope } from '../../lib/scope';
import PaymentScheduleTable from './PaymentScheduleTable';
import ContractDialog from './ContractDialog';
import {
  CONTRACT_STATUS_LABEL, STATUS_BADGE, STATUS_LABEL,
  deleteContract, fetchContracts, paymentStatus, summarize,
  type ContractWithSchedule, type PaymentStatus,
} from '../../lib/qlvh';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
const dateVN = (v?: string) => {
  const d = String(v || '').slice(0, 10);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return dd ? `${dd}/${m}/${y}` : d;
};

/** Bộ lọc theo tình trạng thu tiền của hợp đồng (suy từ các đợt). */
type Filter = 'all' | 'qua_han' | 'sap_den_han' | 'con_phai_thu' | 'da_thu_xong';

const FILTER_OPTIONS = [
  { value: 'all',           label: 'Tất cả hợp đồng' },
  { value: 'qua_han',       label: 'Có đợt quá hạn' },
  { value: 'sap_den_han',   label: 'Có đợt sắp đến hạn' },
  { value: 'con_phai_thu',  label: 'Còn phải thu' },
  { value: 'da_thu_xong',   label: 'Đã thu xong' },
];

/** Trạng thái nặng nhất trong các đợt — dùng làm nhãn cho cả hợp đồng. */
const SEVERITY: PaymentStatus[] = ['qua_han', 'thu_thieu', 'sap_den_han', 'chua_den_han', 'da_thu'];

function worstStatus(row: ContractWithSchedule): PaymentStatus | null {
  if (row.payments.length === 0) return null;
  const found = row.payments.map(p => paymentStatus(p));
  for (const s of SEVERITY) if (found.includes(s)) return s;
  return null;
}

export default function ContractListManager({ scope }: { scope: Scope }) {
  const { areas, canPickArea, allLabel, isOffice } = useScopeAreas(scope);
  const { confirm, dialog } = useConfirm();

  const [rows, setRows] = useState<ContractWithSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  /** null = đóng; '' = thêm mới; id = sửa hợp đồng đó. */
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchContracts()
      .then(data => { if (alive) setRows(data); })
      .catch(err => { if (alive) notify.error(`Không tải được danh sách hợp đồng: ${err.message}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reload]);

  /* Chỉ khối Văn phòng được thêm/sửa/xoá — khớp API rule của PocketBase. */
  const canEdit = isOffice;

  const askDelete = async (row: ContractWithSchedule) => {
    const paid = row.totals.paid > 0;
    const ok = await confirm({
      title: `Xoá hợp đồng ${row.contract.contract_no}?`,
      message: paid
        ? `Hợp đồng đã ghi nhận thu ${money(row.totals.paid)}đ. Xoá là mất luôn toàn bộ ${row.payments.length} đợt và số đã thu.`
        : `Toàn bộ ${row.payments.length} đợt thanh toán sẽ bị xoá theo.`,
      confirmLabel: 'Xoá hợp đồng',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteContract(row.contract.id);
      notify.success('Đã xoá hợp đồng.');
      setReload(n => n + 1);
    } catch (err: any) {
      notify.error(err?.message || 'Xoá hợp đồng thất bại.');
    }
  };

  /* Khối Đội chỉ được thấy KCN của mình — lọc ngay khi vào, không đợi user chọn. */
  const scoped = useMemo(
    () => rows.filter(r => areas.length === 0 || areas.includes(r.zoneName)),
    [rows, areas],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter(r => {
      if (area && r.zoneName !== area) return false;
      if (q && !`${r.contract.contract_no} ${r.customerName}`.toLowerCase().includes(q)) return false;

      const t = r.totals;
      if (filter === 'qua_han' && t.overdueCount === 0) return false;
      if (filter === 'sap_den_han' && t.dueSoonCount === 0) return false;
      if (filter === 'con_phai_thu' && t.remaining <= 0) return false;
      if (filter === 'da_thu_xong' && t.remaining > 0) return false;
      return true;
    });
  }, [scoped, area, filter, query]);

  /* KPI tính trên phần đang hiện, để con số luôn khớp cái mắt đang nhìn. */
  const kpi = useMemo(() => summarize(visible.flatMap(r => r.payments)), [visible]);

  const areaOptions = useMemo(
    () => [{ value: '', label: allLabel }, ...areas.map(a => ({ value: a, label: a }))],
    [areas, allLabel],
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">

      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-ink">Hợp đồng quản lý vận hành</h2>
          <p className="text-sm text-faint mt-1">
            Theo dõi số hợp đồng, ngày ký và lịch thanh toán từng đợt.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing('')} className="vl-btn vl-btn-primary shrink-0" type="button">
            <Plus className="w-4 h-4" /> Thêm hợp đồng
          </button>
        )}
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile
          label="Tổng giá trị" value={money(kpi.valueTotal)} unit="đ"
          sub={`${visible.length} hợp đồng`} icon={FileText} loading={loading}
        />
        <StatTile
          label="Đã thu" value={money(kpi.paid)} unit="đ" tone="ok"
          sub={kpi.valueTotal > 0 ? `${Math.round((kpi.paid / kpi.valueTotal) * 100)}% giá trị` : '—'}
          subTone="ok" icon={Wallet} loading={loading}
        />
        <StatTile
          label="Còn phải thu" value={money(kpi.remaining)} unit="đ"
          tone={kpi.remaining > 0 ? 'warn' : 'ok'} icon={CalendarClock} loading={loading}
          sub={kpi.dueSoonCount > 0 ? `${kpi.dueSoonCount} đợt sắp đến hạn` : 'Không có đợt sắp đến hạn'}
          subTone={kpi.dueSoonCount > 0 ? 'warn' : 'neutral'}
        />
        <StatTile
          label="Quá hạn" value={kpi.overdueCount} unit="đợt"
          tone={kpi.overdueCount > 0 ? 'bad' : 'ok'} icon={AlertTriangle} loading={loading}
          sub={kpi.overdueCount > 0 ? `${money(kpi.overdueAmount)}đ chưa thu` : 'Không có đợt quá hạn'}
          subTone={kpi.overdueCount > 0 ? 'bad' : 'ok'}
        />
      </div>

      {/* Bộ lọc */}
      <div className="vl-card p-4 flex flex-col lg:flex-row gap-3 lg:items-end">
        <div className="flex-1 min-w-0">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">
            Tìm hợp đồng
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Số hợp đồng hoặc tên khách hàng..."
              className="w-full pl-10 pr-4 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none"
            />
          </div>
        </div>

        {canPickArea && (
          <Select
            label="Khu công nghiệp" value={area} onChange={setArea}
            options={areaOptions} icon={Building2} className="lg:w-[240px]"
          />
        )}

        <Select
          label="Tình trạng thu" value={filter} onChange={v => setFilter(v as Filter)}
          options={FILTER_OPTIONS} className="lg:w-[220px]"
        />
      </div>

      {/* Danh sách */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-faint gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" /> Đang tải hợp đồng…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={rows.length === 0 ? 'Chưa có hợp đồng nào' : 'Không có hợp đồng khớp bộ lọc'}
          hint={rows.length === 0
            ? 'Hợp đồng sẽ hiện ở đây sau khi được thêm vào.'
            : 'Thử bỏ bớt điều kiện lọc hoặc xoá từ khoá tìm kiếm.'}
        />
      ) : (
        <div className="vl-accordion">
          {visible.map(row => {
            const c = row.contract;
            const open = openId === c.id;
            const st = worstStatus(row);
            return (
              <div key={c.id} className={`vl-accordion-item ${open ? 'is-open' : ''}`}>
                <button
                  className="vl-accordion-header"
                  onClick={() => setOpenId(open ? null : c.id)}
                >
                  <span className="font-mono text-xs font-bold bg-subtle text-soft px-2 py-0.5 rounded shrink-0">
                    {c.contract_no}
                  </span>

                  <span className="flex-1 min-w-0 text-left">
                    <span className="block font-bold truncate">{row.customerName}</span>
                    <span className="block text-[11px] text-faint mt-0.5 truncate">
                      {row.zoneName} · ký {dateVN(c.sign_date)} · hiệu lực {dateVN(c.effective_from)}–{dateVN(c.effective_to)}
                      {c.status_manual !== 'dang_hieu_luc' && ` · ${CONTRACT_STATUS_LABEL[c.status_manual]}`}
                    </span>
                  </span>

                  <span className="hidden md:block text-right shrink-0">
                    <span className="block text-sm font-semibold tabular-nums">{money(c.value_total)}đ</span>
                    <span className="block text-[11px] text-faint tabular-nums mt-0.5">
                      {row.totals.remaining > 0 ? `còn ${money(row.totals.remaining)}đ` : 'đã thu đủ'}
                    </span>
                  </span>

                  {st && <span className={`${STATUS_BADGE[st]} shrink-0`}>{STATUS_LABEL[st]}</span>}
                  <ChevronRight className="w-4 h-4 vl-accordion-chevron" />
                </button>

                {open && (
                  <div className="vl-accordion-body">
                    <PaymentScheduleTable payments={row.payments} />
                    {c.payment_terms && (
                      <p className="px-5 py-3 text-xs text-soft border-t border-[var(--border)]">
                        <span className="font-semibold text-faint uppercase tracking-wider mr-2">Điều khoản</span>
                        {c.payment_terms}
                      </p>
                    )}
                    {canEdit && (
                      <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border)]">
                        <button onClick={() => setEditing(c.id)} className="vl-btn vl-btn-secondary vl-btn-sm" type="button">
                          <Pencil className="w-3.5 h-3.5" /> Sửa hợp đồng
                        </button>
                        <button onClick={() => askDelete(row)} className="vl-btn vl-btn-danger vl-btn-sm" type="button">
                          <Trash2 className="w-3.5 h-3.5" /> Xoá
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ContractDialog
        open={editing !== null}
        contractId={editing || undefined}
        onClose={() => setEditing(null)}
        onSaved={() => setReload(n => n + 1)}
      />
      {dialog}
    </div>
  );
}
