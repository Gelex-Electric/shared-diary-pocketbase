/**
 * Hộp thoại CHUYỂN CHỦ THỂ điểm đo (user chốt 27/08/2026).
 *
 * Khách hàng đứng tên đổi — hợp nhất pháp nhân, chuyển nhượng nhà xưởng — trong
 * khi ĐIỂM ĐO VẬT LÝ không đổi: vẫn máy biến áp ấy, công tơ ấy, HSN ấy.
 *
 * VÌ SAO PHẢI CÓ RIÊNG chứ không sửa trong form điểm đo: mã điểm đo nhúng tên
 * tắt khách hàng, nên đổi khách trong form sẽ làm mã TỰ ĐỔI theo —
 * `TTI.JOHNSON2.T1.3000kVA` biến thành `TTI.JOHNSON2.T1.3000kVA.JOHNSON1`. Mà
 * mã điểm đo chính là `LINE_NAME` bên HES: đổi mã là lệch với dữ liệu đo đếm và
 * mất liên kết với toàn bộ lịch sử.
 *
 * Ở đây chỉ ghi ba thứ: `customer` mới, một dòng vào `owner_history`, và (tuỳ
 * chọn) một dòng vào `note`. **Mã giữ nguyên tuyệt đối.**
 *
 * Lịch sử ai trả tiền từ ngày nào vốn đã nằm ở hóa đơn; `owner_history` là để
 * danh mục tự nói được điều đó mà không phải đi tra chỗ khác.
 */
import { useState } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { toast } from '../../lib/toast';
import { points as pointRepo, pbErrorMessage } from '../../lib/dm/repo';
import type { CatalogData } from '../../lib/dm/repo';
import type { OwnerTransfer, Point } from '../../lib/dm/types';
import { dmy } from '../../lib/dm/lifecycle';
import { Field, FormModal, TextInput } from './entryUi';

/** Hôm nay, `YYYY-MM-DD`. */
const today = () => new Date().toISOString().slice(0, 10);

export function TransferOwner({ point, d, onClose, onDone }: {
  /** Điểm đo đang chuyển chủ; `null` = đóng. */
  point: Point | null;
  d: CatalogData | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [to, setTo] = useState('');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!point) return null;

  const cusOf = (id?: string) => d?.customers.find(c => c.id === id);
  const from = cusOf(point.customer);
  const next = cusOf(to);

  const opts = (d?.customers ?? [])
    .filter(c => c.id !== point.customer)
    .map(c => ({ value: c.id, label: `${c.mkh} — ${c.name}` }));

  const history = point.owner_history ?? [];

  const blocks: string[] = [];
  if (!to) blocks.push('chưa chọn khách hàng mới');
  if (!date) blocks.push('chưa chọn ngày chuyển');
  const lastDate = history.map(h => h.date).sort().pop();
  if (date && lastDate && date < lastDate) {
    blocks.push(`ngày chuyển sớm hơn lần chuyển gần nhất (${dmy(lastDate)})`);
  }

  const submit = async () => {
    if (blocks.length || !next) return;
    setSaving(true);
    try {
      const entry: OwnerTransfer = {
        from: from?.mkh ?? '',
        to: next.mkh,
        date,
        reason: reason.trim() || undefined,
      };
      const noteLine = `${dmy(date)}: chuyển chủ thể ${entry.from || '(chưa có)'} → ${entry.to}`
        + (entry.reason ? ` (${entry.reason})` : '');

      // CHỦ Ý không gửi `code` / `line_name`: giữ nguyên mã đã lưu.
      await pointRepo.update(point.id, {
        customer: next.id,
        owner_history: [...history, entry],
        note: [point.note?.trim(), noteLine].filter(Boolean).join('\n'),
      });
      toast.success('Đã chuyển chủ thể',
        `${point.code || point.line_name}: ${entry.from || '—'} → ${entry.to}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error('Chuyển chủ thể thất bại', pbErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal open title="Chuyển chủ thể điểm đo" onClose={onClose} onSubmit={submit}
      saving={saving} submitLabel="Chuyển chủ thể" wide>
      <div className="rounded-lg border border-[var(--border)] bg-subtle px-4 py-3">
        <p className="font-mono text-[15px] font-bold text-ink">
          {point.code || point.line_name || point.id}
        </p>
        <p className="mt-1 text-[12px] text-soft">
          Mã điểm đo <b className="text-dim">giữ nguyên</b> — chỉ đổi khách hàng đứng tên.
        </p>
      </div>

      {/* Chủ cũ → chủ mới */}
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 rounded-lg border border-[var(--border)] px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-faint">Chủ thể hiện tại</p>
          <p className="mt-1 text-[13px] text-ink">
            {from ? <><span className="font-mono font-bold">{from.mkh}</span> · {from.name}</>
              : <i className="text-faint">chưa gắn khách hàng</i>}
          </p>
        </div>
        <ArrowRight className="mx-auto h-5 w-5 shrink-0 rotate-90 text-faint sm:rotate-0" />
        <div className="min-w-0 flex-1 rounded-lg border border-accent bg-accent-soft px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-accent">Chủ thể mới</p>
          <p className="mt-1 text-[13px] text-ink">
            {next ? <><span className="font-mono font-bold">{next.mkh}</span> · {next.name}</>
              : <i className="text-faint">chưa chọn</i>}
          </p>
        </div>
      </div>

      <Field label="Khách hàng mới *">
        <Select value={to} onChange={setTo} options={opts}
          placeholder="Chọn khách hàng nhận" searchable icon={Users} />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Ngày chuyển *"
          hint="Lấy theo ngày kỳ hóa đơn đầu tiên đứng tên chủ mới.">
          <DatePicker value={date} onChange={setDate} />
        </Field>
        <Field label="Lý do" hint="Ví dụ: hợp nhất pháp nhân, chuyển nhượng nhà xưởng.">
          <TextInput value={reason} onChange={setReason} placeholder="Hợp nhất pháp nhân" />
        </Field>
      </div>

      {history.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-faint">
            Đã chuyển {history.length} lần
          </p>
          <div className="space-y-1 rounded-lg border border-[var(--border)] px-4 py-3">
            {history.map((h, i) => (
              <p key={i} className="text-[12px] text-soft">
                <span className="font-mono">{dmy(h.date)}</span>
                {'  '}<span className="font-mono font-bold text-dim">{h.from || '—'}</span>
                {' → '}<span className="font-mono font-bold text-dim">{h.to}</span>
                {h.reason ? ` · ${h.reason}` : ''}
              </p>
            ))}
          </div>
        </div>
      )}

      {blocks.length > 0 && (
        <div className="vl-alert vl-alert-light-danger text-[12px]">
          <b>Chưa chuyển được:</b> {blocks.join('; ')}.
        </div>
      )}

      <div className="vl-alert vl-alert-light-info text-[12px]">
        Vật tư, HSN và trạng thái <b>không đổi</b> — điểm đo vật lý vẫn nguyên. Lịch sử ai
        trả tiền từ ngày nào đã nằm ở hóa đơn; mục này để danh mục tự nói được điều đó.
      </div>
    </FormModal>
  );
}
