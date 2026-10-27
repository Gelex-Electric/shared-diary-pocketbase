/**
 * Hộp "THÊM VẬT TƯ TỪ DANH SÁCH" — CÁCH DUY NHẤT khai thêm vật tư vào kho (user
 * chốt 27/10/2026, cùng lúc gỡ tính năng đặt mua). Một bảng mở rộng được hàng, dán
 * cột số No từ Excel (user chốt 28/09/2026); tách khỏi `StockEntry.tsx` 26/10/2026.
 *
 * Mỗi dòng chọn được KIỂU: TI mặc định TRÒN, công tơ mặc định GIÁN TIẾP (user chốt
 * 27/10/2026) — đổi ở ô "Kiểu" của dòng. Phía trên chỉ còn Ngày nhập kho và KCN
 * nhập cho (`hold_zone`); bỏ các ô chung loại / tỷ số / mã lô / dành cho.
 */
import { useEffect, useMemo, useState } from 'react';
import { Camera, Plus, PackagePlus, Trash2 } from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { toast } from '../../lib/toast';
import { CellInput, Field, FormModal } from './entryUi';
import VariantCell from './VariantCell';
import { devices as deviceRepo, pbErrorMessage } from '../../lib/dm/repo';
import { parseRatio } from '../../lib/dm/hsn';
import { findExisting, guessType, parsePaste, SERIAL_RE } from '../../lib/dm/stock';
import type { PlateScan } from '../../lib/dm/plateScan';
import {
  ASSET_LABEL, DEFAULT_TI_SHAPE, SHAPE_LABEL, type AssetType, type Connection, type Device, type TiShape, type Zone,
} from '../../lib/dm/types';

const TYPES: AssetType[] = ['CONGTO', 'TI', 'TU', 'GP03', 'SIM', 'KHAC'];
const HAS_RATIO: AssetType[] = ['TI', 'TU'];
export const SHAPE_OPTS = [
  { value: '', label: 'Chưa rõ' },
  ...(Object.keys(SHAPE_LABEL) as TiShape[]).map(s => ({ value: s, label: SHAPE_LABEL[s] })),
];
const today = () => new Date().toISOString().slice(0, 10);
/** Công tơ mặc định GIÁN TIẾP khi nhập kho (user chốt 27/10/2026) — trực tiếp là trường hợp đổi tay. */
const DEFAULT_METER_KIND: Connection = 'gian_tiep';

/** Một dòng của bảng. Kiểu trống = mặc định (TI tròn, công tơ gián tiếp). */
interface AddRow {
  key: string; serial: string; type: AssetType | ''; ratio: string; model: string;
  shape: TiShape | ''; meterKind: Connection | '';
  /** Dòng đọc từ ảnh nhãn: ảnh thu nhỏ để đối chiếu + nguồn số No (ảnh không lưu). */
  thumb?: string; scan?: PlateScan['source']; barcode?: string;
}

/** Ghi chú nguồn số No của dòng đọc từ ảnh — OCR một mình thì nhắc kiểm tra. */
const SCAN_NOTE: Record<PlateScan['source'], { cls: string; text: string }> = {
  'mã vạch khớp': { cls: 'text-emerald-600', text: 'ảnh: mã vạch khớp chữ in' },
  'mã vạch': { cls: 'text-emerald-600', text: 'ảnh: số lấy từ mã vạch' },
  OCR: { cls: 'text-warn', text: 'ảnh (OCR): kiểm tra lại số No' },
  'lệch': { cls: 'text-red-500', text: 'ảnh: mã vạch ra số khác' },
  '': { cls: 'text-red-500', text: 'ảnh không đọc ra số No — gõ tay' },
};
let addSeq = 0;
const newAddRow = (): AddRow =>
  ({ key: `a${++addSeq}`, serial: '', type: '', ratio: '', model: '', shape: '', meterKind: '' });

/** Tách `200/5` thành hai số; ô trống/sai ⇒ `undefined` (không ghi 0). */
const ratioOf = (s: string) => {
  const { primary, secondary } = parseRatio(s);
  return { ratio_primary: primary ?? undefined, ratio_secondary: secondary ?? undefined };
};

export default function AddStockModal({ open, onClose, devices, zones, onSaved }: {
  open: boolean;
  onClose: () => void;
  /** Thiết bị đang có — để báo dòng nào đã có trong kho. */
  devices: Device[];
  /** Danh sách KCN — chọn KCN nhập cho (`dm_device.hold_zone`). */
  zones: Zone[];
  /** Gọi sau khi ghi (kể cả dừng giữa chừng) với các thiết bị ĐÃ tạo. */
  onSaved: (created: Device[]) => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [addRows, setAddRows] = useState<AddRow[]>([]);
  const [addDate, setAddDate] = useState(today());
  /** KCN nhập cho — ghi `hold_zone`, Kho vật tư xếp thiết bị theo KCN này. */
  const [addZone, setAddZone] = useState('');

  // Mở hộp là làm mới toàn bộ.
  useEffect(() => {
    if (!open) return;
    setAddRows([newAddRow(), newAddRow(), newAddRow()]);
    setAddDate(today()); setAddZone('');
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

  /** Đang đọc ảnh nhãn — chữ tiến độ ('' = rảnh). */
  const [scanning, setScanning] = useState('');

  /**
   * Chụp / chọn ảnh nhãn (user yêu cầu 27/10/2026, plan `2026-10-27-them-vat-tu-bang-anh.md`):
   * mỗi ảnh một thiết bị, đọc lần lượt, đổ vào dòng TRỐNG đầu tiên hoặc thêm dòng.
   */
  const addFromPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    const { scanPlate } = await import('../../lib/dm/plateScan');
    try {
      for (let i = 0; i < list.length; i++) {
        const pre = list.length > 1 ? `Ảnh ${i + 1}/${list.length}: ` : '';
        setScanning(`${pre}đang đọc…`);
        let s: PlateScan;
        try {
          s = await scanPlate(list[i], m => setScanning(pre + m));
        } catch (e) {
          toast.error('Không đọc được ảnh', String((e as Error)?.message ?? e));
          continue;
        }
        const p = s.plate;
        const fill: Partial<AddRow> = {
          serial: s.serial, thumb: s.thumb, scan: s.source, barcode: s.barcode,
          type: p.type || guessType(s.serial) || '',
          ratio: p.ratio ? `${p.ratio.primary}/${p.ratio.secondary}` : '',
          model: p.model ?? '', meterKind: p.meterKind ?? '',
        };
        setAddRows(rs => {
          const at = rs.findIndex(r => !r.serial.trim() && !r.thumb);
          return at < 0 ? [...rs, { ...newAddRow(), ...fill }] : rs.map((r, j) => (j === at ? { ...r, ...fill } : r));
        });
      }
    } finally { setScanning(''); }
  };

  const existing = useMemo(
    () => findExisting(devices, addRows.map(r => r.serial.trim())),
    [devices, addRows]);

  /**
   * Loại của từng dòng: chọn ở dòng > DẠNG SỐ khi chắc chắn (IMEI của GP-03,
   * ICCID của SIM). Kiểu: dòng > mặc định (TI tròn, công tơ gián tiếp).
   */
  const typeOfAdd = (r: AddRow): AssetType | '' => r.type || guessType(r.serial.trim()) || '';
  const ratioOfAdd = (r: AddRow) => r.ratio.trim();
  const shapeOfAdd = (r: AddRow): TiShape => r.shape || DEFAULT_TI_SHAPE;
  const kindOfAdd = (r: AddRow): Connection => r.meterKind || DEFAULT_METER_KIND;

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
          date_in: addDate || '', ...(addZone ? { hold_zone: addZone } : {}),
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
      {/* Chỉ còn ngày nhập + KCN nhập cho (user chốt 27/10/2026). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Ngày nhập kho">
          <DatePicker value={addDate} onChange={setAddDate} usePortal />
        </Field>
        <Field label="Nhập cho KCN" hint="Kho vật tư xếp thiết bị theo KCN này">
          <Select value={addZone} onChange={setAddZone} placeholder="Chưa chọn KCN"
            options={zones.map(z => ({ value: z.id, label: z.name }))} />
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
                      <div className="flex items-center gap-2">
                        {r.thumb && <img src={r.thumb} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
                        <div className="min-w-0 flex-1">
                          <CellInput value={r.serial} mono placeholder="Gõ hoặc dán từ Excel"
                            onPasteText={text => pasteInto(r.key, text)}
                            onChange={v => setAddRow(r.key, { serial: v })} />
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <Select value={r.type} variant="bare"
                        onChange={v => setAddRow(r.key, { type: v as AssetType })}
                        options={TYPES.map(x => ({ value: x, label: ASSET_LABEL[x] }))}
                        placeholder={t && !r.type ? `${ASSET_LABEL[t]} (tự nhận)` : 'Chọn loại'} />
                    </td>
                    <td className="p-2">
                      {HAS_RATIO.includes(t as AssetType) ? (
                        <CellInput value={r.ratio} mono placeholder="200/5"
                          onChange={v => setAddRow(r.key, { ratio: v })} />
                      ) : <span className="block p-2 text-faint">—</span>}
                    </td>
                    <td className="p-2">
                      {/* TI mặc định tròn, công tơ mặc định gián tiếp — đổi ở đây nếu khác. */}
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
                      {r.scan !== undefined && (
                        <span className={`block ${SCAN_NOTE[r.scan].cls}`}>
                          {SCAN_NOTE[r.scan].text}{r.barcode ? ` (${r.barcode})` : ''}
                        </span>
                      )}
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

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => setAddRows(rs => [...rs, newAddRow()])}
            className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
            <Plus className="h-4 w-4" /> Thêm dòng
          </button>
          <label className={`flex items-center gap-1 text-xs font-bold text-blue-600 ${scanning ? 'pointer-events-none opacity-60' : 'cursor-pointer hover:underline'}`}>
            <Camera className="h-4 w-4" /> Chụp / chọn ảnh nhãn
            <input type="file" accept="image/*" multiple className="hidden" disabled={!!scanning}
              onChange={e => { void addFromPhotos(e.target.files); e.target.value = ''; }} />
          </label>
          {scanning && <span className="text-xs text-accent">{scanning}</span>}
        </div>
        <p className="mt-2 text-[11px] text-faint">
          Ảnh nhãn: mỗi ảnh một thiết bị, đọc ngay trên máy (không gửi, không lưu ảnh) — chụp gần, rõ dòng "Số:" / "Tỷ số:";
          dòng ghi "OCR" cần soát lại số No.{' '}
          Dán cả cột số No từ Excel vào một ô Số No — bảng tự thêm dòng; cột dạng 200/5 nhận làm tỷ số.
          TI mặc định tròn, công tơ mặc định gián tiếp — khác thì đổi ở cột Kiểu. Dòng đã có trong kho được bỏ qua, không ghi đè.
        </p>
      </div>
    </FormModal>
  );
}
