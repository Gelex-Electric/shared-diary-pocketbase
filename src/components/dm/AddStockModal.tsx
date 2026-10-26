/**
 * Hộp "THÊM VẬT TƯ VÀO KHO" — một bảng mở rộng được hàng, dán cột số No từ
 * Excel (user chốt 28/09/2026). Tách khỏi `StockEntry.tsx` ngày 26/10/2026 để
 * màn Đặt mua dùng lại đúng hộp này khi NHẬN HÀNG (luồng cấp vật tư đợt 3).
 *
 * `preset` (nhận hàng theo dòng đơn mua): khoá loại / tỷ số / hình dạng theo
 * dòng đơn, gắn `purchase_line` cho mọi thiết bị tạo ra, và báo trước khi vượt
 * số còn chờ của dòng đơn. Không có `preset` thì hành xử y như trước.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, PackagePlus, Trash2 } from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { toast } from '../../lib/toast';
import { CellInput, Field, FormModal, TextInput } from './entryUi';
import { devices as deviceRepo, pbErrorMessage } from '../../lib/dm/repo';
import { formatRatio, parseRatio } from '../../lib/dm/hsn';
import { findExisting, guessType, parsePaste, SERIAL_RE } from '../../lib/dm/stock';
import {
  ASSET_LABEL, SHAPE_LABEL, type AssetType, type Device, type TiShape,
} from '../../lib/dm/types';

const TYPES: AssetType[] = ['CONGTO', 'TI', 'TU', 'GP03', 'SIM', 'KHAC'];
const HAS_RATIO: AssetType[] = ['TI', 'TU'];
export const SHAPE_OPTS = [
  { value: '', label: 'Chưa rõ' },
  ...(Object.keys(SHAPE_LABEL) as TiShape[]).map(s => ({ value: s, label: SHAPE_LABEL[s] })),
];
const today = () => new Date().toISOString().slice(0, 10);

/** Một dòng của bảng "Thêm mới". Loại/tỷ số trống = lấy theo ô chung. */
interface AddRow { key: string; serial: string; type: AssetType | ''; ratio: string; model: string }
let addSeq = 0;
const newAddRow = (): AddRow => ({ key: `a${++addSeq}`, serial: '', type: '', ratio: '', model: '' });

/** Tách `200/5` thành hai số; ô trống/sai ⇒ `undefined` (không ghi 0). */
const ratioOf = (s: string) => {
  const { primary, secondary } = parseRatio(s);
  return { ratio_primary: primary ?? undefined, ratio_secondary: secondary ?? undefined };
};

export interface StockPreset {
  type: AssetType;
  ratio_primary?: number | null;
  ratio_secondary?: number | null;
  shape?: TiShape | '';
  /** Gắn vào mọi thiết bị tạo ra (`dm_device.purchase_line`). */
  purchaseLine?: string;
  /** Số còn chờ của dòng đơn — vượt thì nhắc, không chặn (giao thừa vẫn nhập được). */
  pending?: number;
  /** Mã lô điền sẵn (vd mã đơn mua). */
  batch?: string;
  /** "Dành cho" điền sẵn. */
  holdNote?: string;
}

export default function AddStockModal({ open, onClose, devices, onSaved, title, preset }: {
  open: boolean;
  onClose: () => void;
  /** Thiết bị đang có — để báo dòng nào đã có trong kho. */
  devices: Device[];
  /** Gọi sau khi ghi (kể cả dừng giữa chừng) với các thiết bị ĐÃ tạo. */
  onSaved: (created: Device[]) => void | Promise<void>;
  title?: string;
  preset?: StockPreset;
}) {
  const [saving, setSaving] = useState(false);
  const [addRows, setAddRows] = useState<AddRow[]>([]);
  const [addType, setAddType] = useState<AssetType | ''>('');
  const [addRatio, setAddRatio] = useState('');
  /** Hình dạng chung cho các dòng TI của lô — lô hàng về thường cùng một kiểu. */
  const [addShape, setAddShape] = useState<TiShape | ''>('');
  const [addBatch, setAddBatch] = useState('');
  const [addDate, setAddDate] = useState(today());
  const [addHold, setAddHold] = useState('');
  const locked = !!preset;

  // Mở hộp là làm mới toàn bộ — preset điền sẵn các ô chung.
  useEffect(() => {
    if (!open) return;
    setAddRows([newAddRow(), newAddRow(), newAddRow()]);
    setAddType(preset?.type ?? '');
    setAddRatio(preset ? formatRatio(preset.ratio_primary, preset.ratio_secondary) : '');
    setAddShape(preset?.shape ?? '');
    setAddBatch(preset?.batch ?? '');
    setAddDate(today());
    setAddHold(preset?.holdNote ?? '');
  }, [open, preset]);

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
        // Nhận hàng theo đơn: quy cách đã khoá, bỏ loại/tỷ số đoán từ cột dán.
        const fill = locked
          ? { serial: p.serial }
          : { serial: p.serial, ratio: p.ratio, type: guessType(p.serial) ?? '' as AssetType | '' };
        if (i < next.length) next[i] = { ...next[i], ...fill, type: ('type' in fill && fill.type) || next[i].type };
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
   * ICCID của SIM) > loại chung. Tỷ số: dòng > tỷ số chung. Có preset ⇒ theo preset.
   */
  const typeOfAdd = (r: AddRow): AssetType | '' =>
    locked ? preset!.type : (r.type || guessType(r.serial.trim()) || addType);
  const ratioOfAdd = (r: AddRow) => (locked ? addRatio.trim() : (r.ratio.trim() || addRatio.trim()));

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
    return { kind: 'new', text: 'mới' };
  };
  const addStates = addRows.map((r, i) => addState(r, i));
  const addReady = addRows.filter((_, i) => addStates[i].kind === 'new');
  const addBad = addStates.filter(s => s.kind === 'bad').length;
  const addDup = addStates.filter(s => s.kind === 'dup').length;
  const overPending = preset?.pending != null ? addReady.length - preset.pending : 0;

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
        const rec = await deviceRepo.create({
          serial: r.serial.trim(), type: typeOfAdd(r) as AssetType,
          ...ratioOf(ratioOfAdd(r)), model_desc: r.model.trim(),
          shape: typeOfAdd(r) === 'TI' ? addShape : '',
          date_in: addDate || '', batch: addBatch.trim(), hold_for_note: addHold.trim(),
          ...(preset?.purchaseLine ? { purchase_line: preset.purchaseLine } : {}),
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
    <FormModal open={open} title={title ?? 'Thêm vật tư vào kho'} wide
      onClose={onClose} onSubmit={() => void saveAdd()} saving={saving}
      submitLabel={addReady.length ? `Ghi ${addReady.length} thiết bị` : 'Chưa có gì để ghi'}>
      {/* Ô CHUNG: mặc định cho mọi dòng để trống loại / tỷ số. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={locked ? 'Loại (theo đơn mua)' : 'Loại chung'}
          hint={locked ? undefined : 'Dòng nào chọn loại riêng thì theo dòng đó'}>
          <Select value={addType} onChange={v => setAddType(v as AssetType)} disabled={locked}
            options={TYPES.map(t => ({ value: t, label: ASSET_LABEL[t] }))} placeholder="Chọn loại" />
        </Field>
        <Field label={locked ? 'Tỷ số (theo đơn mua)' : 'Tỷ số chung'}
          hint={locked ? undefined : 'Cho TI / TU — dòng có tỷ số riêng thì theo dòng'}>
          <TextInput value={addRatio} onChange={setAddRatio} mono placeholder="200/5"
            disabled={locked && !!addRatio} />
        </Field>
        <Field label="Hình dạng TI" hint="Áp cho mọi dòng TI của lô">
          <Select value={addShape} onChange={v => setAddShape(v as TiShape | '')} options={SHAPE_OPTS}
            disabled={locked && !!preset?.shape} />
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

      {overPending > 0 && (
        <div className="vl-alert vl-alert-light-warning text-[12px]">
          Nhập {addReady.length} thiết bị, nhiều hơn số còn chờ của dòng đơn ({preset!.pending}) {overPending} cái —
          vẫn ghi được nếu nhà cung cấp giao thừa.
        </div>
      )}

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
              <col style={{ width: '26%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-subtle">
              <tr>
                <th className="px-4 py-3 text-left font-bold text-soft">Số No</th>
                <th className="px-4 py-3 text-left font-bold text-soft">Loại</th>
                <th className="px-4 py-3 text-left font-bold text-soft">Tỷ số</th>
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
                      {locked ? (
                        <span className="block p-2 text-soft">{ASSET_LABEL[preset!.type]}</span>
                      ) : (
                        <Select value={r.type} variant="bare"
                          onChange={v => setAddRow(r.key, { type: v as AssetType })}
                          options={TYPES.map(x => ({ value: x, label: ASSET_LABEL[x] }))}
                          placeholder={t && !r.type ? `${ASSET_LABEL[t]} (chung)` : 'Chọn loại'} />
                      )}
                    </td>
                    <td className="p-2">
                      {HAS_RATIO.includes(t as AssetType) ? (
                        locked ? <span className="block p-2 font-mono">{addRatio || '—'}</span> : (
                          <CellInput value={r.ratio} mono placeholder={addRatio || '200/5'}
                            onChange={v => setAddRow(r.key, { ratio: v })} />
                        )
                      ) : <span className="block p-2 text-faint">—</span>}
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
          Dán cả cột số No từ Excel vào một ô Số No — bảng tự thêm dòng
          {locked ? '.' : '; cột dạng 200/5 nhận làm tỷ số.'}
          {' '}Dòng đã có trong kho được bỏ qua, không ghi đè.
        </p>
      </div>
    </FormModal>
  );
}
