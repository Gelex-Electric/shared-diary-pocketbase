/**
 * Hộp "THÊM VẬT TƯ TỪ DANH SÁCH" — CÁCH DUY NHẤT khai thêm vật tư vào kho (user
 * chốt 27/10/2026, cùng lúc gỡ tính năng đặt mua). Một bảng mở rộng được hàng, dán
 * cột số No từ Excel (user chốt 28/09/2026); tách khỏi `StockEntry.tsx` 26/10/2026.
 *
 * Mỗi dòng chọn được KIỂU: công tơ trực tiếp / gián tiếp, TI tròn / vuông (ô
 * "Kiểu"); dòng không chọn thì theo ô chung phía trên.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, PackagePlus, Trash2 } from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { toast } from '../../lib/toast';
import { CellInput, Field, FormModal, TextInput } from './entryUi';
import VariantCell, { METER_KIND_PICK } from './VariantCell';
import { devices as deviceRepo, pbErrorMessage } from '../../lib/dm/repo';
import { parseRatio } from '../../lib/dm/hsn';
import { findExisting, guessType, parsePaste, SERIAL_RE } from '../../lib/dm/stock';
import {
  ASSET_LABEL, DEFAULT_TI_SHAPE, SHAPE_LABEL, type AssetType, type Connection, type Device, type TiShape,
} from '../../lib/dm/types';

const TYPES: AssetType[] = ['CONGTO', 'TI', 'TU', 'GP03', 'SIM', 'KHAC'];
const HAS_RATIO: AssetType[] = ['TI', 'TU'];
export const SHAPE_OPTS = [
  { value: '', label: 'Chưa rõ' },
  ...(Object.keys(SHAPE_LABEL) as TiShape[]).map(s => ({ value: s, label: SHAPE_LABEL[s] })),
];
const today = () => new Date().toISOString().slice(0, 10);

/** Một dòng của bảng. Loại / tỷ số / kiểu trống = lấy theo ô chung. */
interface AddRow {
  key: string; serial: string; type: AssetType | ''; ratio: string; model: string;
  shape: TiShape | ''; meterKind: Connection | '';
}
let addSeq = 0;
const newAddRow = (): AddRow =>
  ({ key: `a${++addSeq}`, serial: '', type: '', ratio: '', model: '', shape: '', meterKind: '' });

/** Tách `200/5` thành hai số; ô trống/sai ⇒ `undefined` (không ghi 0). */
const ratioOf = (s: string) => {
  const { primary, secondary } = parseRatio(s);
  return { ratio_primary: primary ?? undefined, ratio_secondary: secondary ?? undefined };
};

export default function AddStockModal({ open, onClose, devices, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** Thiết bị đang có — để báo dòng nào đã có trong kho. */
  devices: Device[];
  /** Gọi sau khi ghi (kể cả dừng giữa chừng) với các thiết bị ĐÃ tạo. */
  onSaved: (created: Device[]) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [addRows, setAddRows] = useState<AddRow[]>([]);
  const [addType, setAddType] = useState<AssetType | ''>('');
  const [addRatio, setAddRatio] = useState('');
  /** Hình dạng chung cho các dòng TI — mặc định tròn (vuông là ngoại lệ). */
  const [addShape, setAddShape] = useState<TiShape | ''>(DEFAULT_TI_SHAPE);
  /** Loại chung cho các dòng công tơ (trực tiếp / gián tiếp — schema v24). */
  const [addKind, setAddKind] = useState<Connection | ''>('');
  const [addBatch, setAddBatch] = useState('');
  const [addDate, setAddDate] = useState(today());
  const [addHold, setAddHold] = useState('');

  // Mở hộp là làm mới toàn bộ.
  useEffect(() => {
    if (!open) return;
    setAddRows([newAddRow(), newAddRow(), newAddRow()]);
    setAddType(''); setAddRatio(''); setAddShape(DEFAULT_TI_SHAPE); setAddKind('');
    setAddBatch(''); setAddDate(today()); setAddHold('');
  }, [open]);

  const setAddRow = (key: string, patch: Partial<AddRow>) =>
    setAddRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  /**
   * Dán vào ô Số No: một số lẻ thì để ô dán bình thường; nhiều dòng (hoặc có
   * tab — nhiều cột Excel) thì tách bằng `parsePaste`, đổ vào dòng hiện tại và
   * các dòng TRỐNG phía sau, thiếu thì thêm dòng.
   */
  const pasteInto = (key: string, text: string): boolean => {
    if (!/[\r\n\t]/.test(text.trim())) return false;
    const got = parsePaste(text).filter(p => p.serial);
    if (!got.length) return false;
    setAddRows(rs => {
      const at = rs.findIndex(r => r.key === key);
      const next = [...rs];
      let i = at;
      for (const p of got) {
        while (i < next.length && i !== at && next[i].serial.trim()) i++;
        const fill = { serial: p.serial, ratio: p.ratio, type: guessType(p.serial) ?? '' as AssetType | '' };
        if (i < next.length) next[i] = { ...next[i], ...fill, type: fill.type || next[i].type };
        else next.push({ ...newAddRow(), ...fill });
        i++;
      }
      return next;
    });
    return true;
  };

  const existing = useMemo(
    () => findExisting(devices, addRows.map(r => r.serial.trim())),
    [devices, addRows]);

  /**
   * Loại của từng dòng: chọn ở dòng > DẠNG SỐ khi chắc chắn (IMEI của GP-03,
   * ICCID của SIM) > loại chung. Tỷ số, kiểu: dòng > ô chung.
   */
  const typeOfAdd = (r: AddRow): AssetType | '' => r.type || guessType(r.serial.trim()) || addType;
  const ratioOfAdd = (r: AddRow) => (r.ratio.trim() || addRatio.trim());
  const shapeOfAdd = (r: AddRow): TiShape | '' => r.shape || addShape;
  const kindOfAdd = (r: AddRow): Connection | '' => r.meterKind || addKind;

  /** Tình trạng từng dòng — hiện ngay trong bảng, như bản xem trước cũ. */
  const addState = (r: AddRow, i: number): { kind: 'empty' | 'new' | 'dup' | 'bad'; text: string } => {
    const sn = r.serial.trim();
    if (!sn) return { kind: 'empty', text: '' };
    if (!SERIAL_RE.test(sn)) return { kind: 'bad', text: 'số No phải là 8–20 chữ số' };
    if (addRows.slice(0, i).some(x => x.serial.trim() === sn)) return { kind: 'bad', text: 'trùng dòng trên' };
    const had = existing.get(sn);
    if (had) return { kind: 'dup', text: `đã có (${ASSET_LABEL[had.type]})` };
    const t = typeOfAdd(r);
    if (!t) return { kind: 'bad', text: 'chưa chọn loại' };
    if (HAS_RATIO.includes(t) && !ratioOfAdd(r)) return { kind: 'bad', text: 'thiếu tỷ số' };
    if (t === 'CONGTO' && !kindOfAdd(r)) return { kind: 'bad', text: 'chưa chọn trực tiếp / gián tiếp' };
    return { kind: 'new', text: 'mới' };
  };
  const addStates = addRows.map((r, i) => addState(r, i));
  const addReady = addRows.filter((_, i) => addStates[i].kind === 'new');
  const addBad = addStates.filter(s => s.kind === 'bad').length;
  const addDup = addStates.filter(s => s.kind === 'dup').length;

  const saveAdd = async () => {
    if (addBad) {
      return toast.warning('Chưa ghi được', `${addBad} dòng còn lỗi — xem cột "Tình trạng".`);
    }
    if (!addReady.length) return toast.warning('Chưa có gì để ghi', 'Nhập hoặc dán số No vào bảng.');
    setSaving(true);
    const created: Device[] = [];
    try {
      // Tuần tự: lỗi giữa chừng thì biết chính xác đã ghi tới đâu.
      for (const r of addReady) {
        const t = typeOfAdd(r) as AssetType;
        const rec = await deviceRepo.create({
          serial: r.serial.trim(), type: t,
          ...ratioOf(ratioOfAdd(r)), model_desc: r.model.trim(),
          shape: t === 'TI' ? shapeOfAdd(r) : '',
          meter_kind: t === 'CONGTO' ? kindOfAdd(r) : '',
          date_in: addDate || '', batch: addBatch.trim(), hold_for_note: addHold.trim(),
        });
        created.push(rec as unknown as Device);
      }
      toast.success('Đã nhập kho', `${created.length} thiết bị.`);
      await onSaved(created);
    } catch (e) {
      toast.error(`Dừng sau ${created.length} thiết bị`, pbErrorMessage(e));
      await onSaved(created);
    } finally { setSaving(false); }
  };

  return (
    <FormModal open={open} title="Thêm vật tư từ danh sách" wide
      onClose={onClose} onSubmit={() => void saveAdd()} saving={saving}
      submitLabel={addReady.length ? `Ghi ${addReady.length} thiết bị` : 'Chưa có gì để ghi'}>
      {/* Ô CHUNG: mặc định cho mọi dòng để trống loại / tỷ số / kiểu. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Loại chung" hint="Dòng nào chọn loại riêng thì theo dòng đó">
          <Select value={addType} onChange={v => setAddType(v as AssetType)}
            options={TYPES.map(t => ({ value: t, label: ASSET_LABEL[t] }))} placeholder="Chọn loại" />
        </Field>
        <Field label="Tỷ số chung" hint="Cho TI / TU — dòng có tỷ số riêng thì theo dòng">
          <TextInput value={addRatio} onChange={setAddRatio} mono placeholder="200/5" />
        </Field>
        <Field label="Hình dạng TI chung" hint="Dòng TI nào chọn kiểu riêng thì theo dòng">
          <Select value={addShape} onChange={v => setAddShape(v as TiShape | '')} options={SHAPE_OPTS} />
        </Field>
        <Field label="Loại công tơ chung" hint="Trực tiếp: điểm đo không TI · Gián tiếp: qua TI">
          <Select value={addKind} onChange={v => setAddKind(v as Connection | '')} options={METER_KIND_PICK} />
        </Field>
        <Field label="Mã lô">
          <TextInput value={addBatch} onChange={setAddBatch} placeholder="LO-2026-08" />
        </Field>
        <Field label="Ngày nhập kho">
          <DatePicker value={addDate} onChange={setAddDate} usePortal />
        </Field>
        <Field label="Dành cho" hint="Khách chưa có trong danh mục thì gõ tự do">
          <TextInput value={addHold} onChange={setAddHold} placeholder="Nhà máy X, lô B3" />
        </Field>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-subtle p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
            <PackagePlus className="h-4 w-4" /> Danh sách thiết bị
          </p>
          <span className="flex flex-wrap gap-3 text-[11px] font-bold">
            <span className="text-emerald-600">Sẽ ghi: {addReady.length}</span>
            {addDup > 0 && <span className="text-warn">Đã có trong kho (bỏ qua): {addDup}</span>}
            {addBad > 0 && <span className="text-red-500">Lỗi: {addBad}</span>}
          </span>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-surface">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-subtle">
              <tr>
                <th className="px-4 py-3 text-left font-bold text-soft">Số No</th>
                <th className="px-4 py-3 text-left font-bold text-soft">Loại</th>
                <th className="px-4 py-3 text-left font-bold text-soft">Tỷ số</th>
                <th className="px-4 py-3 text-left font-bold text-soft"
                  title="Công tơ: trực tiếp / gián tiếp · TI: tròn / vuông">Kiểu</th>
                <th className="px-4 py-3 text-left font-bold text-soft">Model / mô tả</th>
                <th className="px-4 py-3 text-left font-bold text-soft">Tình trạng</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {addRows.map((r, i) => {
                const st = addStates[i];
                const t = typeOfAdd(r);
                return (
                  <tr key={r.key} className={st.kind === 'dup' ? 'opacity-60' : ''}>
                    <td className="p-2">
                      <CellInput value={r.serial} mono placeholder="Gõ hoặc dán từ Excel"
                        onPasteText={text => pasteInto(r.key, text)}
                        onChange={v => setAddRow(r.key, { serial: v })} />
                    </td>
                    <td className="p-2">
                      <Select value={r.type} variant="bare"
                        onChange={v => setAddRow(r.key, { type: v as AssetType })}
                        options={TYPES.map(x => ({ value: x, label: ASSET_LABEL[x] }))}
                        placeholder={t && !r.type ? `${ASSET_LABEL[t]} (chung)` : 'Chọn loại'} />
                    </td>
                    <td className="p-2">
                      {HAS_RATIO.includes(t as AssetType) ? (
                        <CellInput value={r.ratio} mono placeholder={addRatio || '200/5'}
                          onChange={v => setAddRow(r.key, { ratio: v })} />
                      ) : <span className="block p-2 text-faint">—</span>}
                    </td>
                    <td className="p-2">
                      {/* Hiện giá trị đang áp (dòng hoặc ô chung); chọn ở đây là riêng cho dòng. */}
                      <VariantCell type={t} shape={shapeOfAdd(r)} meterKind={kindOfAdd(r)}
                        onShape={shape => setAddRow(r.key, { shape })}
                        onMeterKind={meterKind => setAddRow(r.key, { meterKind })} />
                    </td>
                    <td className="p-2">
                      <CellInput value={r.model} onChange={v => setAddRow(r.key, { model: v })} />
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {st.kind === 'new' && <span className="text-emerald-600">{st.text}</span>}
                      {st.kind === 'dup' && <span className="text-warn">{st.text}</span>}
                      {st.kind === 'bad' && <span className="text-red-500">{st.text}</span>}
                    </td>
                    <td className="p-2 text-center">
                      <button type="button" title="Bỏ dòng"
                        onClick={() => setAddRows(rs => rs.filter(x => x.key !== r.key))}
                        className="p-1 text-faint transition-colors hover:text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button type="button" onClick={() => setAddRows(rs => [...rs, newAddRow()])}
          className="mt-3 flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
          <Plus className="h-4 w-4" /> Thêm dòng
        </button>
        <p className="mt-2 text-[11px] text-faint">
          Dán cả cột số No từ Excel vào một ô Số No — bảng tự thêm dòng; cột dạng 200/5 nhận làm tỷ số.
          Công tơ bắt buộc chọn trực tiếp / gián tiếp. Dòng đã có trong kho được bỏ qua, không ghi đè.
        </p>
      </div>
    </FormModal>
  );
}
