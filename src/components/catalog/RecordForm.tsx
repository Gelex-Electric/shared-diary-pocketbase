import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { CatalogData } from '../../lib/catalog';
import { Select } from '../ui/Select';
import {
  type EntityKind, type FieldDef, fieldsOf, ENTITY_LABEL, parseRatioText,
} from '../../lib/catalogCrud';

/** Form thêm/sửa dựng từ mô tả trường trong catalogCrud.fieldsOf(). */
export default function RecordForm({
  kind, record, data, onClose, onSave,
}: {
  kind: EntityKind;
  record: Record<string, any> | null;   // null = thêm mới
  data: CatalogData;
  onClose: () => void;
  onSave: (body: Record<string, any>) => Promise<void>;
}) {
  const fields = fieldsOf(kind);
  const [v, setV] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const init: Record<string, any> = {};
    for (const f of fields) init[f.name] = record?.[f.name] ?? '';
    setV(init);
    setErr('');
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, kind]);

  const relOptions = (f: FieldDef) => {
    if (f.relFrom === 'zone') return data.zones.map(z => ({ value: z.id, label: `${z.code} — ${z.name}` }));
    if (f.relFrom === 'station') return data.stations.map(s => ({ value: s.id, label: s.code }));
    if (f.relFrom === 'warehouse') return data.warehouses.map(w => ({ value: w.id, label: `${w.code} — ${w.name}` }));
    return [];
  };

  const submit = async () => {
    const missing = fields
      .filter(f => f.required && (!f.showIf || f.showIf(v)))
      .filter(f => String(v[f.name] ?? '').trim() === '')
      .map(f => f.label);
    if (missing.length) { setErr('Thiếu: ' + missing.join(', ')); return; }

    setBusy(true);
    setErr('');
    try {
      const body: Record<string, any> = {};
      for (const f of fields) {
        if (f.showIf && !f.showIf(v)) continue;
        const raw = v[f.name];
        if (f.type === 'number') body[f.name] = raw === '' || raw == null ? null : Number(raw);
        else if (f.type === 'bool') body[f.name] = !!raw;
        else body[f.name] = raw ?? '';
      }
      if (kind === 'asset' && 'ratio_text' in body) {
        const parsed = parseRatioText(String(body.ratio_text ?? ''));
        if (!parsed) { setErr('Tỷ số phải dạng 2000/5'); setBusy(false); return; }
        delete body.ratio_text;
        Object.assign(body, parsed);
      }
      await onSave(body);
    } catch (e: any) {
      // PocketBase trả lỗi field-level -> hiện nguyên văn, đừng nuốt
      const detail = e?.response?.data
        ? Object.entries(e.response.data).map(([k, x]: any) => `${k}: ${x?.message ?? x}`).join('; ')
        : (e?.message || String(e));
      setErr(detail);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="vl-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-ink">
            {record ? 'Sửa' : 'Thêm'} {ENTITY_LABEL[kind].toLowerCase()}
          </h3>
          <button onClick={onClose} disabled={busy} className="text-faint hover:text-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map(f => {
            if (f.showIf && !f.showIf(v)) return null;
            const common = 'mt-1 w-full px-3 py-2 bg-surface border border-[var(--border)] rounded text-sm focus:ring-2 focus:ring-accent outline-none';
            return (
              <label key={f.name} className="block">
                <span className="text-xs font-semibold text-soft">
                  {f.label}{f.required && <span className="text-bad"> *</span>}
                </span>
                {f.type === 'bool' ? (
                  <div className="mt-1 flex items-center h-[38px]">
                    <input
                      type="checkbox" checked={!!v[f.name]}
                      onChange={e => setV({ ...v, [f.name]: e.target.checked })}
                      className="w-4 h-4 accent-[var(--accent)]"
                    />
                  </div>
                ) : f.type === 'select' || f.type === 'rel' ? (
                  <div className="mt-1">
                    <Select
                      value={v[f.name] ?? ''}
                      onChange={val => setV({ ...v, [f.name]: val })}
                      options={f.type === 'rel' ? relOptions(f) : (f.options ?? [])}
                      placeholder="— chọn —"
                      searchable={(f.type === 'rel' ? relOptions(f) : (f.options ?? [])).length > 8}
                    />
                  </div>
                ) : (
                  <input
                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={v[f.name] ?? ''}
                    onChange={e => setV({ ...v, [f.name]: e.target.value })}
                    readOnly={f.readOnly}
                    className={`${common} ${f.readOnly ? 'bg-subtle text-faint cursor-not-allowed' : ''}`}
                  />
                )}
                {f.hint && <span className="text-[0.7rem] text-faint">{f.hint}</span>}
              </label>
            );
          })}
        </div>

        {err && <p className="text-sm text-bad">{err}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy}
            className="vl-btn vl-btn-secondary">
            Hủy
          </button>
          <button onClick={submit} disabled={busy}
            className="vl-btn vl-btn-primary">
            {busy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
