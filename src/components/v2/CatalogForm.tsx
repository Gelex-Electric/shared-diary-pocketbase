/**
 * Biểu mẫu thêm/sửa một bản ghi danh mục kho.
 *
 * Cố ý KHÔNG có ô cho `status` / `current_point`: đó là trường dẫn xuất từ sổ
 * nhật ký. Cho sửa tay ở đây thì luật R1–R7 vô hiệu, vì ai cũng đặt thẳng được
 * kết quả mà không đi qua thao tác treo/tháo.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import {
  fieldsOf, validate, createRecord, updateRecord, readableError,
  type EntityKind, type FieldDef, ENTITY_LABEL,
} from '../../lib/v2/whWrite';
import type { WhData } from '../../lib/v2/wh';

export default function CatalogForm({
  kind, record, data, onClose, onSaved,
}: {
  kind: EntityKind;
  record: Record<string, any> | null;
  data: WhData;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const fields = fieldsOf(kind);
  const [v, setV] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const f of fields) {
      const raw = record?.[f.name];
      init[f.name] = f.type === 'date' ? String(raw ?? '').slice(0, 10) : (raw ?? '');
    }
    return init;
  });
  const [errs, setErrs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isEdit = Boolean(record?.id);
  const set = (name: string, val: unknown) => setV(s => ({ ...s, [name]: val }));

  const options = (f: FieldDef): Array<{ value: string; label: string }> => {
    if (f.type === 'select') return (f.options ?? []).map(o => ({ value: o, label: o }));
    switch (f.relFrom) {
      case 'customer': return data.customers.map(c => ({ value: c.id, label: `${c.mkh} — ${c.ten}` }));
      case 'deviceType': return data.deviceTypes.map(t => ({ value: t.id, label: t.name || t.code }));
      case 'warehouse': return data.warehouses.map(w => ({ value: w.id, label: `${w.code} — ${w.name}` }));
      case 'point': return data.points.map(p => ({ value: p.id, label: p.point_code }));
      case 'zone': return data.zones.map(z => ({ value: z.id, label: z.code }));
      case 'station': return data.stations.map(st => ({ value: st.id, label: st.code }));
      default: return [];
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate(kind, v);
    setErrs(found);
    if (found.length) return;
    setBusy(true);
    try {
      if (isEdit) {
        await updateRecord(kind, record!.id, v);
        onSaved(`Đã cập nhật ${ENTITY_LABEL[kind].toLowerCase()}`);
      } else {
        await createRecord(kind, v);
        onSaved(`Đã thêm ${ENTITY_LABEL[kind].toLowerCase()}`);
      }
    } catch (err) {
      setErrs([readableError(err)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <form onSubmit={submit} className="vl-card vl-drawer w-full max-w-[560px] p-5 mt-8 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[16px] font-semibold flex-1">
            {isEdit ? 'Sửa' : 'Thêm'} {ENTITY_LABEL[kind].toLowerCase()}
          </h3>
          <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-subtle text-faint" aria-label="Đóng">
            <X className="w-4 h-4" />
          </button>
        </div>

        {errs.length > 0 && (
          <div className="vl-alert vl-alert-light-danger text-[13px]">
            {errs.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {fields.map(f => {
            const disabled = isEdit && kind === 'device' && f.name === 'current_warehouse';
            return (
              <label key={f.name} className={f.type === 'bool' ? 'sm:col-span-2 flex items-center gap-2' : 'block'}>
                {f.type !== 'bool' && (
                  <span className="block text-[12px] text-faint mb-1">
                    {f.label}{f.required && <span className="text-bad"> *</span>}
                  </span>
                )}

                {f.type === 'select' || f.type === 'rel' ? (
                  <select
                    value={String(v[f.name] ?? '')} onChange={e => set(f.name, e.target.value)}
                    disabled={disabled}
                    className="w-full px-3 py-2 rounded-lg bg-inset border border-hair text-[13px] disabled:opacity-60"
                  >
                    <option value="">—</option>
                    {options(f).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'bool' ? (
                  <>
                    <input
                      type="checkbox" checked={Boolean(v[f.name])}
                      onChange={e => set(f.name, e.target.checked)}
                    />
                    <span className="text-[13px]">{f.label}</span>
                  </>
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                    value={String(v[f.name] ?? '')} onChange={e => set(f.name, e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-inset border border-hair text-[13px]"
                  />
                )}

                {f.hint && <span className="block text-[11.5px] text-faint mt-1">{f.hint}</span>}
                {disabled && <span className="block text-[11.5px] text-faint mt-1">
                  Đổi kho phải qua thao tác điều chuyển để sổ nhật ký còn khớp.
                </span>}
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-hair text-[13px]">
            Huỷ
          </button>
          <button type="submit" disabled={busy}
            className="px-4 py-2 rounded-lg bg-accent text-[var(--on-accent)] text-[13px] font-semibold disabled:opacity-60">
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </form>
    </div>
  );
}
