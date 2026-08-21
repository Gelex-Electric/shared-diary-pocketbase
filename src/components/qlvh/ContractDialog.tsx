/**
 * Hộp thoại thêm / sửa hợp đồng QLVH kèm lịch đợt thanh toán.
 *
 * Nguyên tắc bám theo:
 *  - VAT và tổng sau thuế là ô DẪN XUẤT, chỉ hiện, không cho gõ (computeVat).
 *  - Nút "Sinh lịch thanh toán" chỉ tạo BẢN NHÁP — mọi dòng vẫn sửa tay được.
 *  - Đợt đã ghi nhận thu tiền thì KHOÁ (isLocked): không sửa ngày/tiền, không
 *    xoá, không sinh lại lịch. Sửa hồi tố cái đã đối chiếu với kế toán là mất dấu.
 *  - Tổng các đợt lệch giá trị hợp đồng thì CẢNH BÁO MỀM, không chặn lưu.
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle, CalendarClock, FileSignature, Lock, Plus, RefreshCw, Trash2, Wand2, X,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast as notify } from '../../lib/toast';
import {
  CONTRACT_STATUS_LABEL, buildSchedule, computeVat, durationMonths, fetchContract,
  fetchCustomers, fetchZones, isLocked, saveContract, scheduleWarning,
  type ContractStatus, type DmCustomer, type DmZone, type PaymentInput,
} from '../../lib/qlvh';

const INPUT =
  'w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm ' +
  'focus:ring-2 focus:ring-accent outline-none disabled:opacity-60 disabled:cursor-not-allowed';

const money = (v: number) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
/** Ô tiền: gõ gì cũng chỉ giữ chữ số, hiện lại có dấu phân cách. */
const parseMoney = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;

const VAT_OPTIONS = [
  { value: '0', label: 'Không chịu thuế (0%)' },
  { value: '5', label: '5%' },
  { value: '8', label: '8%' },
  { value: '10', label: '10%' },
];

const STATUS_OPTIONS = (Object.keys(CONTRACT_STATUS_LABEL) as ContractStatus[])
  .map(v => ({ value: v, label: CONTRACT_STATUS_LABEL[v] }));

/** Dòng lịch trong form — thêm cờ `locked` để giao diện biết khoá ô nào. */
interface Row extends PaymentInput {
  locked: boolean;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-faint mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-faint mt-1">{hint}</p>}
    </div>
  );
}

export default function ContractDialog({
  open, contractId, onClose, onSaved,
}: {
  open: boolean;
  contractId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { confirm, dialog } = useConfirm();

  const [customers, setCustomers] = useState<DmCustomer[]>([]);
  const [zones, setZones] = useState<DmZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [contractNo, setContractNo] = useState('');
  const [customer, setCustomer] = useState('');
  const [zone, setZone] = useState('');
  const [signDate, setSignDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [beforeVat, setBeforeVat] = useState(0);
  const [vatRate, setVatRate] = useState(8);
  const [terms, setTerms] = useState('');
  const [status, setStatus] = useState<ContractStatus>('dang_hieu_luc');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);

  const { value_vat, value_total } = useMemo(() => computeVat(beforeVat, vatRate), [beforeVat, vatRate]);
  const warning = useMemo(() => scheduleWarning(rows, value_total), [rows, value_total]);
  const months = useMemo(() => (from && to ? durationMonths(from, to) : 0), [from, to]);
  const hasLocked = rows.some(r => r.locked);

  /* Danh mục nạp một lần khi mở hộp thoại. */
  useEffect(() => {
    if (!open) return;
    Promise.all([fetchCustomers(), fetchZones()])
      .then(([cs, zs]) => { setCustomers(cs); setZones(zs); })
      .catch(err => notify.error(`Không tải được danh mục: ${err.message}`));
  }, [open]);

  /* Nạp hợp đồng đang sửa, hoặc dọn sạch form khi thêm mới. */
  useEffect(() => {
    if (!open) return;
    if (!contractId) {
      setContractNo(''); setCustomer(''); setZone(''); setSignDate(''); setFrom(''); setTo('');
      setBeforeVat(0); setVatRate(8); setTerms(''); setStatus('dang_hieu_luc'); setNote(''); setRows([]);
      return;
    }
    setLoading(true);
    fetchContract(contractId)
      .then(({ contract: c, payments }) => {
        setContractNo(c.contract_no);
        setCustomer(c.customer);
        setZone(c.zone);
        setSignDate(String(c.sign_date || '').slice(0, 10));
        setFrom(String(c.effective_from || '').slice(0, 10));
        setTo(String(c.effective_to || '').slice(0, 10));
        setBeforeVat(c.value_before_vat || 0);
        setVatRate(c.vat_rate ?? 8);
        setTerms(c.payment_terms || '');
        setStatus(c.status_manual || 'dang_hieu_luc');
        setNote(c.note || '');
        setRows(payments.map(p => ({
          seq: p.seq,
          due_date: String(p.due_date || '').slice(0, 10),
          pct: p.pct,
          amount_due: p.amount_due,
          paid_date: String(p.paid_date || '').slice(0, 10),
          amount_paid: p.amount_paid,
          invoice_no: p.invoice_no,
          note: p.note,
          locked: isLocked(p),
        })));
      })
      .catch(err => notify.error(`Không tải được hợp đồng: ${err.message}`))
      .finally(() => setLoading(false));
  }, [open, contractId]);

  /* Chọn khách thì điền sẵn KCN theo danh mục — vẫn cho đổi tay nếu đặc thù. */
  const pickCustomer = (id: string) => {
    setCustomer(id);
    const c = customers.find(x => x.id === id);
    if (c?.zone && !zone) setZone(c.zone);
  };

  const generate = async () => {
    if (!from) { notify.error('Nhập ngày hiệu lực trước khi sinh lịch.'); return; }
    if (hasLocked) {
      notify.error('Hợp đồng đã có đợt ghi nhận thu tiền — không sinh lại lịch được.');
      return;
    }
    if (rows.length > 0) {
      const ok = await confirm({
        title: 'Sinh lại lịch thanh toán?',
        message: `Toàn bộ ${rows.length} đợt đang có sẽ bị thay bằng lịch mới.`,
        confirmLabel: 'Sinh lại',
        variant: 'warning',
      });
      if (!ok) return;
    }
    const draft = buildSchedule(from, to, value_total);
    setRows(draft.map(d => ({ ...d, locked: false })));
    notify.success(`Đã sinh ${draft.length} đợt — sửa lại từng dòng nếu hợp đồng có điều khoản riêng.`);
  };

  const patchRow = (i: number, patch: Partial<Row>) =>
    setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const addRow = () =>
    setRows(rs => [...rs, {
      seq: rs.length > 0 ? Math.max(...rs.map(r => r.seq)) + 1 : 1,
      due_date: '', amount_due: 0, locked: false,
    }]);

  const removeRow = (i: number) => setRows(rs => rs.filter((_, k) => k !== i));

  /** Nhập % thì tự quy ra tiền — nhưng vẫn LƯU RA TIỀN để báo cáo khỏi tính lại. */
  const setPct = (i: number, pct: number) =>
    patchRow(i, { pct, amount_due: Math.round((value_total * pct) / 100) });

  const save = async () => {
    if (!contractNo.trim()) { notify.error('Chưa nhập số hợp đồng.'); return; }
    if (!customer) { notify.error('Chưa chọn khách hàng.'); return; }
    if (!zone) { notify.error('Chưa chọn khu công nghiệp.'); return; }
    if (from && to && to < from) { notify.error('Ngày hết hiệu lực đang trước ngày hiệu lực.'); return; }
    if (rows.some(r => !r.due_date)) { notify.error('Có đợt chưa nhập ngày đến hạn.'); return; }

    setSaving(true);
    try {
      await saveContract(
        {
          contract_no: contractNo.trim(), customer, zone,
          sign_date: signDate, effective_from: from, effective_to: to,
          value_before_vat: beforeVat, vat_rate: vatRate, value_vat, value_total,
          payment_terms: terms, status_manual: status, note,
        },
        rows.map(({ locked: _locked, ...r }) => r),
        contractId,
      );
      notify.success(contractId ? 'Đã cập nhật hợp đồng.' : 'Đã thêm hợp đồng.');
      onSaved();
      onClose();
    } catch (err: any) {
      notify.error(err?.message || 'Lưu hợp đồng thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const customerOptions = useMemo(
    () => customers.map(c => ({ value: c.id, label: `${c.mkh} — ${c.name}` })),
    [customers],
  );
  const zoneOptions = useMemo(() => zones.map(z => ({ value: z.id, label: z.name })), [zones]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[60] flex items-start md:items-center justify-center p-4 overflow-y-auto">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="relative w-full max-w-5xl max-h-[90vh] my-4 flex flex-col bg-surface rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--border)] bg-subtle/60 shrink-0">
                <div className="p-2 bg-accent-soft rounded-xl text-accent">
                  <FileSignature className="w-5 h-5" />
                </div>
                <h3 className="flex-1 text-lg font-black text-ink tracking-tight">
                  {contractId ? 'Sửa hợp đồng' : 'Thêm hợp đồng'}
                </h3>
                <button onClick={onClose} className="p-2 rounded-lg text-faint hover:bg-subtle hover:text-dim transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {loading ? (
                  <div className="flex items-center justify-center py-16 text-faint gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin" /> Đang tải hợp đồng…
                  </div>
                ) : (
                  <>
                    {/* Thông tin chung */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Số hợp đồng *">
                        <input value={contractNo} onChange={e => setContractNo(e.target.value)}
                          placeholder="VD: 12/2026/HĐQLVH" className={INPUT} />
                      </Field>
                      <Field label="Khách hàng *">
                        <Select value={customer} onChange={pickCustomer} options={customerOptions}
                          placeholder="Chọn khách hàng..." searchable />
                      </Field>
                      <Field label="Khu công nghiệp *">
                        <Select value={zone} onChange={setZone} options={zoneOptions} placeholder="Chọn KCN..." />
                      </Field>
                      <Field label="Trạng thái hợp đồng">
                        <Select value={status} onChange={v => setStatus(v as ContractStatus)} options={STATUS_OPTIONS} />
                      </Field>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Field label="Ngày ký">
                        <DatePicker value={signDate} onChange={setSignDate} usePortal />
                      </Field>
                      <Field label="Hiệu lực từ">
                        <DatePicker value={from} onChange={setFrom} usePortal />
                      </Field>
                      <Field label="Hiệu lực đến"
                        hint={months > 0 ? `Thời hạn ${months} tháng` : undefined}>
                        <DatePicker value={to} onChange={setTo} usePortal />
                      </Field>
                    </div>

                    {/* Giá trị */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                      <Field label="Giá trị trước thuế (đ)">
                        <input value={beforeVat ? money(beforeVat) : ''} inputMode="numeric"
                          onChange={e => setBeforeVat(parseMoney(e.target.value))}
                          placeholder="0" className={`${INPUT} text-right tabular-nums`} />
                      </Field>
                      <Field label="Thuế suất">
                        <Select value={String(vatRate)} onChange={v => setVatRate(Number(v))} options={VAT_OPTIONS} />
                      </Field>
                      <Field label="Tiền thuế (tự tính)">
                        <input value={money(value_vat)} disabled className={`${INPUT} text-right tabular-nums`} />
                      </Field>
                      <Field label="Tổng sau thuế (tự tính)">
                        <input value={money(value_total)} disabled
                          className={`${INPUT} text-right tabular-nums font-bold text-ink`} />
                      </Field>
                    </div>

                    {/* Lịch thanh toán */}
                    <div className="vl-card overflow-hidden">
                      <div className="flex flex-wrap items-center gap-3 px-5 py-3.5 border-b border-[var(--border)] bg-subtle/40">
                        <CalendarClock className="w-4 h-4 text-accent shrink-0" />
                        <span className="font-bold text-sm text-ink flex-1">Lịch thanh toán</span>
                        <button onClick={generate} disabled={hasLocked}
                          className="vl-btn vl-btn-outline-primary vl-btn-sm" type="button">
                          <Wand2 className="w-3.5 h-3.5" /> Sinh lịch thanh toán
                        </button>
                        <button onClick={addRow} className="vl-btn vl-btn-secondary vl-btn-sm" type="button">
                          <Plus className="w-3.5 h-3.5" /> Thêm đợt
                        </button>
                      </div>

                      {hasLocked && (
                        <p className="px-5 py-2.5 text-[11px] text-soft border-b border-[var(--border)] flex items-center gap-2">
                          <Lock className="w-3.5 h-3.5 shrink-0" />
                          Đợt đã ghi nhận thu tiền được khoá. Muốn sửa thì xoá phiếu thu của đợt đó trước.
                        </p>
                      )}

                      {rows.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-faint">
                          Chưa có đợt nào. Nhập ngày hiệu lực rồi bấm <b>Sinh lịch thanh toán</b>,
                          hoặc thêm từng đợt bằng tay.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="vl-table w-full text-left border-collapse min-w-[720px]">
                            <thead>
                              <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider bg-subtle/50">
                                <th className="py-2.5 px-3 w-[64px] text-center">Đợt</th>
                                <th className="py-2.5 px-3 w-[190px]">Đến hạn</th>
                                <th className="py-2.5 px-3 w-[110px] text-right">% giá trị</th>
                                <th className="py-2.5 px-3 text-right">Số tiền (đ)</th>
                                <th className="py-2.5 px-3 w-[60px]" />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r, i) => (
                                <tr key={i} className="border-b border-[var(--border)] last:border-0">
                                  <td className="py-2 px-3 text-center font-bold tabular-nums text-ink">
                                    {r.locked ? <Lock className="w-3.5 h-3.5 inline mr-1 text-faint" /> : null}
                                    {r.seq}
                                  </td>
                                  <td className="py-2 px-3">
                                    {r.locked ? (
                                      <span className="tabular-nums text-soft">{r.due_date}</span>
                                    ) : (
                                      <DatePicker value={r.due_date} onChange={v => patchRow(i, { due_date: v })} usePortal />
                                    )}
                                  </td>
                                  <td className="py-2 px-3">
                                    <input value={r.pct ?? ''} inputMode="numeric" disabled={r.locked}
                                      onChange={e => setPct(i, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
                                      placeholder="—" className={`${INPUT} text-right tabular-nums`} />
                                  </td>
                                  <td className="py-2 px-3">
                                    <input value={r.amount_due ? money(r.amount_due) : ''} inputMode="numeric"
                                      disabled={r.locked}
                                      onChange={e => patchRow(i, { amount_due: parseMoney(e.target.value), pct: undefined })}
                                      placeholder="0" className={`${INPUT} text-right tabular-nums`} />
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    <button type="button" onClick={() => removeRow(i)} disabled={r.locked}
                                      className="p-1.5 rounded text-faint hover:text-[var(--danger)] hover:bg-subtle disabled:opacity-30 disabled:cursor-not-allowed">
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {warning && (
                        <p className="vl-alert vl-alert-light-warning m-4 flex items-start gap-2 text-xs">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{warning} Vẫn lưu được — kiểm tra lại nếu không phải do làm tròn.</span>
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Điều khoản thanh toán">
                        <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3}
                          placeholder="Trích từ hợp đồng…" className={INPUT} />
                      </Field>
                      <Field label="Ghi chú">
                        <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className={INPUT} />
                      </Field>
                    </div>
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)] bg-subtle/40 shrink-0">
                <button onClick={onClose} className="vl-btn vl-btn-secondary" type="button">Huỷ</button>
                <button onClick={save} disabled={saving || loading} className="vl-btn vl-btn-primary" type="button">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                  {contractId ? 'Lưu thay đổi' : 'Thêm hợp đồng'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {dialog}
    </>
  );
}
