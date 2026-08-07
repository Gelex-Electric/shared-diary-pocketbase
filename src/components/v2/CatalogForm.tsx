/**
 * Biểu mẫu thêm/sửa một bản ghi danh mục kho.
 *
 * Cố ý KHÔNG có ô cho `status` / `current_point`: đó là trường dẫn xuất từ sổ
 * nhật ký. Cho sửa tay ở đây thì luật R1–R7 vô hiệu, vì ai cũng đặt thẳng được
 * kết quả mà không đi qua thao tác treo/tháo.
 */
import { useState } from 'react';
import { X, Wand2 } from 'lucide-react';
import {
  fieldsOf, validate, createRecord, updateRecord, readableError,
  suggestStationCode, normalizeTat, isValidTat,
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
  /** Chỉ dùng cho biểu mẫu trạm: hai mảnh không phải trường của trạm nhưng cần để đề xuất mã. */
  const [ghepKH, setGhepKH] = useState('');
  const [ghepDinhDanh, setGhepDinhDanh] = useState('');

  const isEdit = Boolean(record?.id);
  const set = (name: string, val: unknown) => setV(s => ({ ...s, [name]: val }));

  const options = (f: FieldDef): Array<{ value: string; label: string }> => {
    if (f.type === 'select') return (f.options ?? []).map(o => ({ value: o, label: o }));
    switch (f.relFrom) {
      case 'customer': return data.customers.map(c => ({ value: c.id, label: `${c.mkh} — ${c.ten}` }));
      case 'deviceType': return data.deviceTypes.map(t => ({ value: t.id, label: t.name || t.code }));
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

        {kind === 'station' && (
          <GoiYMaTram
            data={data}
            zoneId={String(v.zone ?? '')}
            kva={v.cong_suat_kva}
            khachHang={ghepKH} setKhachHang={setGhepKH}
            dinhDanh={ghepDinhDanh} setDinhDanh={setGhepDinhDanh}
            onApply={code => set('code', code)}
          />
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {fields.map(f => {
            const disabled = isEdit && kind === 'device' && f.name === 'zone';
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

                {kind === 'customer' && f.name === 'tat'
                  && String(v.tat ?? '').trim() && !isValidTat(String(v.tat)) && (
                  <button type="button" onClick={() => set('tat', normalizeTat(String(v.tat)))}
                    className="mt-1 text-[11.5px] text-accent underline">
                    Dùng “{normalizeTat(String(v.tat))}” cho hợp lệ
                  </button>
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

/**
 * Khối đề xuất mã trạm theo quy ước user đưa ra 07/08:
 *   <mã ngắn KCN>.<tên tắt KH><tên định danh>.<công suất>KVA
 *
 * Khách hàng và tên định danh KHÔNG phải trường của trạm — chúng chỉ là
 * nguyên liệu để ghép mã, nên để riêng ở đây thay vì thêm cột vào bảng trạm.
 * Mã đề xuất vẫn sửa tay được trước khi lưu.
 */
function GoiYMaTram({
  data, zoneId, kva, khachHang, setKhachHang, dinhDanh, setDinhDanh, onApply,
}: {
  data: WhData; zoneId: string; kva: unknown;
  khachHang: string; setKhachHang: (v: string) => void;
  dinhDanh: string; setDinhDanh: (v: string) => void;
  onApply: (code: string) => void;
}) {
  const zone = data.zones.find(z => z.id === zoneId);
  const kh = data.customers.find(c => c.id === khachHang);
  const code = suggestStationCode({
    zoneShort: zone?.short_code || zone?.code,
    tat: kh?.tat,
    dinhDanh,
    kva: kva as number,
  });

  return (
    <div className="vl-alert vl-alert-light-primary space-y-2">
      <p className="text-[12px] font-medium flex items-center gap-1.5">
        <Wand2 className="w-3.5 h-3.5" /> Đề xuất mã trạm
      </p>
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11.5px] mb-1">Khách hàng</span>
          <select value={khachHang} onChange={e => setKhachHang(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg bg-inset border border-hair text-[12.5px]">
            <option value="">—</option>
            {data.customers.map(c => (
              <option key={c.id} value={c.id}>{c.tat || c.mkh} — {c.ten}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11.5px] mb-1">Tên định danh trạm</span>
          <input value={dinhDanh} onChange={e => setDinhDanh(e.target.value)}
            placeholder="T1, T2, NX9..."
            className="w-full px-2 py-1.5 rounded-lg bg-inset border border-hair text-[12.5px]" />
        </label>
      </div>
      {kh && kh.tat && !isValidTat(kh.tat) && (
        <p className="text-[11.5px] text-bad">
          Tên tắt “{kh.tat}” chưa hợp lệ (còn dấu hoặc khoảng trắng) — mã dưới đây đã chuẩn hoá tạm.
        </p>
      )}
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[13px] font-medium">{code || '— chọn KCN và khách hàng —'}</code>
        <button type="button" disabled={!code} onClick={() => onApply(code)}
          className="px-3 py-1.5 rounded-lg bg-accent text-[var(--on-accent)] text-[12.5px] font-semibold disabled:opacity-40">
          Dùng mã này
        </button>
      </div>
    </div>
  );
}
