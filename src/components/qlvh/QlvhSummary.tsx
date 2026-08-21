/**
 * Tổng hợp hợp đồng QLVH — màn mở đầu của khu vực QLVH.
 *
 * Trả lời 4 câu hỏi trong 5 giây: sắp phải đòi ai, ai đang quá hạn, đã thu được
 * bao nhiêu, hợp đồng nào sắp hết hiệu lực cần tái ký.
 *
 * Không có luật nghiệp vụ nào ở đây — mọi trạng thái đều gọi qlvhRules.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CalendarClock, CalendarX2, FileText, RefreshCw, Wallet,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { StatTile, EmptyState, Panel } from '../ui/dashboard';
import { toast as notify } from '../../lib/toast';
import { useScopeAreas, type Scope } from '../../lib/scope';
import {
  STATUS_BADGE, STATUS_LABEL, daysBetween, dayOf, fetchContracts, overdueDays,
  paymentStatus, remainingOf, summarize, todayStr,
  type ContractWithSchedule, type Payment,
} from '../../lib/qlvh';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
const dateVN = (v?: string) => {
  const d = dayOf(v);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};

/** Cửa sổ nhìn tới của bảng "sắp đến hạn" — rộng hơn ngưỡng badge 15 ngày. */
const HORIZON_DAYS = 30;
/** Hợp đồng hết hiệu lực trong ngần này ngày thì nhắc tái ký. */
const RENEW_DAYS = 90;

interface DueRow {
  payment: Payment;
  contractNo: string;
  customerName: string;
  zoneName: string;
}

export default function QlvhSummary({ scope }: { scope: Scope }) {
  const { areas, canPickArea, allLabel } = useScopeAreas(scope);
  const [rows, setRows] = useState<ContractWithSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea] = useState('');
  const today = todayStr();

  useEffect(() => {
    let alive = true;
    fetchContracts()
      .then(d => { if (alive) setRows(d); })
      .catch(err => { if (alive) notify.error(`Không tải được hợp đồng: ${err.message}`); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const visible = useMemo(
    () => rows.filter(r =>
      (areas.length === 0 || areas.includes(r.zoneName)) && (!area || r.zoneName === area)),
    [rows, areas, area],
  );

  const kpi = useMemo(() => summarize(visible.flatMap(r => r.payments), today), [visible, today]);

  /** Mọi đợt chưa thu đủ, kèm thông tin hợp đồng — nguồn cho 2 bảng dưới. */
  const dueRows = useMemo<DueRow[]>(
    () => visible.flatMap(r => r.payments
      .filter(p => remainingOf(p) > 0)
      .map(p => ({
        payment: p,
        contractNo: r.contract.contract_no,
        customerName: r.customerName,
        zoneName: r.zoneName,
      }))),
    [visible],
  );

  const overdue = useMemo(
    () => dueRows
      .filter(d => paymentStatus(d.payment, today) === 'qua_han')
      .sort((a, b) => dayOf(a.payment.due_date).localeCompare(dayOf(b.payment.due_date))),
    [dueRows, today],
  );

  const upcoming = useMemo(
    () => dueRows
      .filter(d => {
        const left = daysBetween(today, dayOf(d.payment.due_date));
        return left >= 0 && left <= HORIZON_DAYS;
      })
      .sort((a, b) => dayOf(a.payment.due_date).localeCompare(dayOf(b.payment.due_date))),
    [dueRows, today],
  );

  const renewing = useMemo(
    () => visible
      .filter(r => {
        const to = dayOf(r.contract.effective_to);
        if (!to || r.contract.status_manual !== 'dang_hieu_luc') return false;
        const left = daysBetween(today, to);
        return left >= 0 && left <= RENEW_DAYS;
      })
      .sort((a, b) => dayOf(a.contract.effective_to).localeCompare(dayOf(b.contract.effective_to))),
    [visible, today],
  );

  const areaOptions = useMemo(
    () => [{ value: '', label: allLabel }, ...areas.map(a => ({ value: a, label: a }))],
    [areas, allLabel],
  );

  const renderDueTable = (list: DueRow[], showLate: boolean) => (
    <div className="overflow-x-auto">
      <table className="vl-table w-full text-left border-collapse min-w-[720px]">
        <thead>
          <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
            <th className="py-3 px-4 w-[150px]">Số hợp đồng</th>
            <th className="py-3 px-4">Khách hàng</th>
            <th className="py-3 px-4 w-[110px] text-center">Đợt</th>
            <th className="py-3 px-4 w-[120px] text-center">Đến hạn</th>
            <th className="py-3 px-4 w-[150px] text-right">Còn phải thu</th>
            <th className="py-3 px-4 w-[150px] text-center">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {list.map(d => {
            const st = paymentStatus(d.payment, today);
            const late = overdueDays(d.payment, today);
            const left = daysBetween(today, dayOf(d.payment.due_date));
            return (
              <tr key={d.payment.id} className="border-b border-[var(--border)] last:border-0">
                <td className="py-3 px-4">
                  <span className="font-mono text-xs font-bold text-soft">{d.contractNo}</span>
                </td>
                <td className="py-3 px-4">
                  <span className="block font-semibold text-ink truncate">{d.customerName}</span>
                  <span className="block text-[11px] text-faint">{d.zoneName}</span>
                </td>
                <td className="py-3 px-4 text-center tabular-nums text-soft">Đợt {d.payment.seq}</td>
                <td className="py-3 px-4 text-center tabular-nums text-soft">{dateVN(d.payment.due_date)}</td>
                <td className="py-3 px-4 text-right tabular-nums font-bold text-ink">
                  {money(remainingOf(d.payment))}đ
                </td>
                <td className="py-3 px-4 text-center">
                  <span className={STATUS_BADGE[st]}>
                    {STATUS_LABEL[st]}
                    {showLate && late > 0 && ` ${late} ngày`}
                    {!showLate && left >= 0 && ` · còn ${left} ngày`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-faint gap-2">
        <RefreshCw className="w-5 h-5 animate-spin" /> Đang tải hợp đồng…
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-ink">Tổng hợp hợp đồng QLVH</h2>
          <p className="text-sm text-faint mt-1">
            {visible.length} hợp đồng · cập nhật theo ngày {dateVN(today)}
          </p>
        </div>
        {canPickArea && (
          <Select value={area} onChange={setArea} options={areaOptions}
            icon={Building2} className="sm:w-[240px]" />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile label="Tổng giá trị" value={money(kpi.valueTotal)} unit="đ"
          sub={`${visible.length} hợp đồng`} icon={FileText} />
        <StatTile label="Đã thu" value={money(kpi.paid)} unit="đ" tone="ok" icon={Wallet}
          sub={kpi.valueTotal > 0 ? `${Math.round((kpi.paid / kpi.valueTotal) * 100)}% giá trị` : '—'}
          subTone="ok" />
        <StatTile label="Còn phải thu" value={money(kpi.remaining)} unit="đ"
          tone={kpi.remaining > 0 ? 'warn' : 'ok'} icon={CalendarClock}
          sub={`${upcoming.length} đợt đến hạn trong ${HORIZON_DAYS} ngày`}
          subTone={upcoming.length > 0 ? 'warn' : 'neutral'} />
        <StatTile label="Quá hạn" value={overdue.length} unit="đợt"
          tone={overdue.length > 0 ? 'bad' : 'ok'} icon={AlertTriangle}
          sub={overdue.length > 0 ? `${money(kpi.overdueAmount)}đ chưa thu` : 'Không có đợt quá hạn'}
          subTone={overdue.length > 0 ? 'bad' : 'ok'} />
      </div>

      <Panel title="Đợt quá hạn" icon={AlertTriangle}
        sub={overdue.length > 0 ? `${overdue.length} đợt · ${money(kpi.overdueAmount)}đ` : undefined}>
        {overdue.length === 0
          ? <EmptyState icon={AlertTriangle} title="Không có đợt nào quá hạn" hint="Tất cả các đợt đến hạn đều đã được thu." />
          : renderDueTable(overdue, true)}
      </Panel>

      <Panel title={`Sắp đến hạn trong ${HORIZON_DAYS} ngày`} icon={CalendarClock}
        sub={upcoming.length > 0 ? `${upcoming.length} đợt · ${money(upcoming.reduce((s, d) => s + remainingOf(d.payment), 0))}đ` : undefined}>
        {upcoming.length === 0
          ? <EmptyState icon={CalendarClock} title="Chưa có đợt nào đến hạn" hint={`Không có đợt thanh toán nào trong ${HORIZON_DAYS} ngày tới.`} />
          : renderDueTable(upcoming, false)}
      </Panel>

      <Panel title={`Hợp đồng sắp hết hiệu lực (${RENEW_DAYS} ngày)`} icon={CalendarX2}
        sub={renewing.length > 0 ? `${renewing.length} hợp đồng cần chuẩn bị tái ký` : undefined}>
        {renewing.length === 0
          ? <EmptyState icon={CalendarX2} title="Chưa có hợp đồng nào sắp hết hạn" hint={`Không hợp đồng nào hết hiệu lực trong ${RENEW_DAYS} ngày tới.`} />
          : (
            <div className="overflow-x-auto">
              <table className="vl-table w-full text-left border-collapse min-w-[640px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                    <th className="py-3 px-4 w-[150px]">Số hợp đồng</th>
                    <th className="py-3 px-4">Khách hàng</th>
                    <th className="py-3 px-4 w-[130px] text-center">Hết hiệu lực</th>
                    <th className="py-3 px-4 w-[120px] text-center">Còn lại</th>
                    <th className="py-3 px-4 w-[150px] text-right">Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {renewing.map(r => (
                    <tr key={r.contract.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-3 px-4 font-mono text-xs font-bold text-soft">{r.contract.contract_no}</td>
                      <td className="py-3 px-4">
                        <span className="block font-semibold text-ink truncate">{r.customerName}</span>
                        <span className="block text-[11px] text-faint">{r.zoneName}</span>
                      </td>
                      <td className="py-3 px-4 text-center tabular-nums text-soft">{dateVN(r.contract.effective_to)}</td>
                      <td className="py-3 px-4 text-center tabular-nums font-semibold text-ink">
                        {daysBetween(today, dayOf(r.contract.effective_to))} ngày
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-ink">
                        {money(r.contract.value_total)}đ
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
    </div>
  );
}
