/**
 * KHO VẬT TƯ — khai thiết bị trước, gắn điểm đo sau.
 *
 * Vì sao có màn này: có vật tư đặt về để dự phòng, hoặc dành sẵn cho khách
 * hàng tương lai chưa có tên; và vật tư tháo khỏi điểm đo thì quay về kho, có
 * thể rất lâu sau mới tái sử dụng hoặc thanh lý (user chốt 28/08/2026).
 *
 * LỐI NHẬP CHÍNH LÀ DÁN, không phải gõ. Dữ liệu nguồn nằm sẵn trong Excel và
 * hàng về theo lô vài chục cái, nên gõ tay từng số 10–20 chữ số vừa chậm vừa
 * sai. Dán xong thì XEM TRƯỚC rồi mới ghi — đúng khuôn dry-run của mấy script
 * đã cứu cả ngày 28/08: mỗi dòng nói rõ mới / đã có ở đâu / sai chỗ nào.
 *
 * Bảng và nút bấm dùng lại `entryUi` + `vl-*` sẵn có, không vẽ kiểu mới.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, RefreshCw, Trash2, Edit2, Link2, PackageOpen, PackagePlus, Search,
  ChevronDown, ChevronRight, Recycle,
} from 'lucide-react';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DateTimePickers';
import { useConfirm } from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import {
  CellInput, Field, FormModal, INPUT_CLS, TextInput, TH_CLS,
} from './entryUi';
import { ZoneTables } from './ZoneTables';
import { groupByZone, sortByCode } from './groupByZone';
import {
  devices as deviceRepo, assets as assetRepo, loadCatalog, pbErrorMessage, isAbortError,
  type CatalogData,
} from '../../lib/dm/repo';
import {
  ASSET_LABEL, DEVICE_STATUS_LABEL, type AssetType, type Device, type DeviceStatus,
} from '../../lib/dm/types';
import { pointZoneId } from '../../lib/dm/pointScope';
import {
  buildStock, findExisting, guessType, idleDays, parsePaste, SERIAL_RE,
  IDLE_WARN_DAYS, REUSE_MIN, type StockRow,
} from '../../lib/dm/stock';
import type { Point } from '../../lib/dm/types';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import { dmy } from '../../lib/dm/lifecycle';

const TYPES: AssetType[] = ['CONGTO', 'TI', 'TU', 'GP03', 'SIM', 'KHAC'];
/** Loại có tỷ số — chỉ hai loại này mới hiện ô tỷ số, giống form điểm đo. */
const HAS_RATIO: AssetType[] = ['TI', 'TU'];
const today = () => new Date().toISOString().slice(0, 10);

/** Một dòng của bảng "Thêm mới". Loại/tỷ số trống = lấy theo ô chung. */
interface AddRow { key: string; serial: string; type: AssetType | ''; ratio: string; model: string }
let addSeq = 0;
const newAddRow = (): AddRow => ({ key: `a${++addSeq}`, serial: '', type: '', ratio: '', model: '' });

/** Chip lọc bấm một phát — nhanh hơn mở select rồi chọn rồi đóng. */
function Chip({ on, onClick, children }: {
  on: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1 text-[12px] font-bold transition-colors ${on
        ? 'bg-accent text-white'
        : 'bg-subtle text-soft hover:text-dim'}`}>
      {children}
    </button>
  );
}

const STATUS_CLS: Record<Exclude<DeviceStatus, ''>, string> = {
  kho: 'bg-subtle text-soft',
  dang_treo: 'bg-[var(--success-soft)] text-emerald-600',
  thanh_ly: 'bg-[var(--danger-soft)] text-red-500',
};

export default function StockEntry() {
  const { confirm, dialog } = useConfirm();
  const [d, setD] = useState<CatalogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /*
    CHỈ HAI bộ lọc: trạng thái + ô tìm (user chốt 04/09/2026 — "cắt gọn, chỉ giữ
    cái cần thiết"). Bản đầu có thêm chip loại, chip vòng đời, chọn KCN, chọn
    lô — 12 nút cho một bảng. Ô tìm đã bắt được loại, lô, nơi giữ chỗ, nên mấy
    bộ lọc kia chỉ là cách thứ hai để làm cùng một việc.
  */
  const [status, setStatus] = useState<DeviceStatus | ''>('');
  const [search, setSearch] = useState('');
  /** Dòng đang mở xem lịch sử lắp đặt. */
  const [openRow, setOpenRow] = useState<string | null>(null);

  /** `one` = SỬA một thiết bị; thêm mới (lẻ hay theo lô) đều qua `add`. */
  const [modal, setModal] = useState<'one' | 'add' | 'attach' | null>(null);
  const [editing, setEditing] = useState<Device | null>(null);
  /** Các thiết bị đang tích chọn — để gắn cả bộ vào một điểm đo một lượt. */
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    try { setD(await loadCatalog()); } catch (e) {
      // Request bị huỷ giữa chừng không phải lỗi — lần nạp mới đang chạy.
      if (!isAbortError(e)) toast.error('Không đọc được dữ liệu', pbErrorMessage(e));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  /** KCN của điểm đo nằm ở TRẠM (đầu nguồn: ở chính nó / lộ) — tra hộ. */
  const zoneOfPoint = (p?: Point) =>
    d ? pointZoneId(p, d.stations, d.lines) : undefined;

  const rows = useMemo(
    () => (d ? buildStock(d.devices, d.assets, d.points, zoneOfPoint) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d]);

  const terms = useMemo(() => buildTerms(search), [search]);
  /** Đang giữ cho ai — điểm đo cụ thể nếu có, không thì ghi chú tự do. */
  const holdText = (r: StockRow) => r.holdingPoint?.code ?? (r.device.hold_for_note ?? '');

  const shown = useMemo(() => rows.filter(r => {
    if (status && r.status !== status) return false;
    // Loại đưa vào chuỗi tìm để gõ "TI" hay "GP-03" là ra, khỏi cần chip riêng.
    return matchesTerms(
      [r.device.serial, ASSET_LABEL[r.device.type], r.device.batch, holdText(r),
        r.atPoint?.code, r.device.note], terms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, status, terms, d]);

  /**
   * Gom theo KCN rồi mỗi KCN một thẻ — cùng khuôn bảng Điểm đo (user chốt
   * 28/08/2026). Trong mỗi thẻ xếp theo số No để mắt dò xuôi được.
   */
  const groups = useMemo(
    () => groupByZone(sortByCode(shown, r => r.device.serial), r => r.zoneId, d?.zones ?? []),
    [shown, d]);

  const count = (s: DeviceStatus) => rows.filter(r => r.status === s).length;
  const idleLong = rows.filter(r => r.status === 'kho' && idleDays(r, today()) > IDLE_WARN_DAYS).length;

  /* ------------------------- khai một thiết bị ------------------------- */
  const EMPTY = {
    serial: '', type: '' as AssetType | '', ratio: '', model_desc: '',
    hold_for_note: '', date_in: today(), batch: '', note: '',
  };
  const [form, setForm] = useState(EMPTY);

  const openEdit = (dev: Device) => {
    setEditing(dev);
    setForm({
      serial: dev.serial, type: dev.type, model_desc: dev.model_desc ?? '',
      ratio: dev.ratio_primary != null ? `${dev.ratio_primary}/${dev.ratio_secondary ?? ''}` : '',
      hold_for_note: dev.hold_for_note ?? '', date_in: (dev.date_in ?? '').slice(0, 10),
      batch: dev.batch ?? '', note: dev.note ?? '',
    });
    setModal('one');
  };

  const ratioOf = (s: string) => {
    const [a, b] = s.split('/');
    const num = (x?: string) => {
      const v = parseFloat((x ?? '').trim().replace(',', '.'));
      return Number.isFinite(v) ? v : undefined;
    };
    return { ratio_primary: num(a), ratio_secondary: num(b) };
  };

  const saveOne = async () => {
    const serial = form.serial.trim();
    if (!SERIAL_RE.test(serial)) {
      return toast.warning('Số No không hợp lệ', 'Phải là 8–20 chữ số.');
    }
    if (!form.type) return toast.warning('Thiếu loại vật tư', 'Chọn loại trước khi lưu.');
    // Tỷ số bắt buộc với TI/TU — cùng luật đã chốt cho form điểm đo 27/08.
    if (HAS_RATIO.includes(form.type) && !form.ratio.trim()) {
      return toast.warning('Thiếu tỷ số',
        `${ASSET_LABEL[form.type]} phải có tỷ số thì mới suy được HSN.`);
    }
    const clash = (d?.devices ?? []).find(x => x.serial.trim() === serial && x.id !== editing?.id);
    if (clash) {
      return toast.error('Trùng số No',
        `${serial} đã có trong kho (${ASSET_LABEL[clash.type]}).`);
    }
    const body: Partial<Device> = {
      serial, type: form.type, model_desc: form.model_desc.trim(),
      ...ratioOf(form.ratio),
      hold_for_note: form.hold_for_note.trim(),
      date_in: form.date_in || '', batch: form.batch.trim(), note: form.note.trim(),
    };
    setSaving(true);
    try {
      if (editing) await deviceRepo.update(editing.id, body);
      else await deviceRepo.create(body);
      toast.success(editing ? 'Đã cập nhật' : 'Đã thêm', serial);
      setModal(null);
      await load();
    } catch (e) { toast.error('Không lưu được', pbErrorMessage(e)); } finally { setSaving(false); }
  };

  /* ------------------- THÊM MỚI: bảng nhiều dòng + dán ------------------- */
  /*
    Gộp "Thêm một" và "Dán danh sách" thành MỘT nút "Thêm mới" (user chốt
    28/09/2026): một bảng mở rộng được hàng, cùng khuôn bảng vật tư ở form điểm
    đo. Thêm một cái = một dòng; nhập lô = dán cột Excel vào ô Số No, bảng tự
    nở thêm dòng. Các ô CHUNG phía trên là mặc định cho mọi dòng để trống.
  */
  const [addRows, setAddRows] = useState<AddRow[]>([]);
  const [addType, setAddType] = useState<AssetType | ''>('');
  const [addRatio, setAddRatio] = useState('');
  const [addBatch, setAddBatch] = useState('');
  const [addDate, setAddDate] = useState(today());
  const [addHold, setAddHold] = useState('');

  const openAddMany = () => {
    setAddRows([newAddRow(), newAddRow(), newAddRow()]);
    setAddType(''); setAddRatio(''); setAddBatch(''); setAddDate(today()); setAddHold('');
    setModal('add');
  };
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
    () => findExisting(d?.devices ?? [], addRows.map(r => r.serial.trim())),
    [d, addRows]);

  /**
   * Loại của từng dòng: chọn ở dòng > DẠNG SỐ khi chắc chắn (IMEI của GP-03,
   * ICCID của SIM) > loại chung. Tỷ số: dòng > tỷ số chung.
   */
  const typeOfAdd = (r: AddRow): AssetType | '' => r.type || guessType(r.serial.trim()) || addType;
  const ratioOfAdd = (r: AddRow) => (r.ratio.trim() || addRatio.trim());

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
    let n = 0;
    try {
      // Tuần tự: lỗi giữa chừng thì biết chính xác đã ghi tới đâu.
      for (const r of addReady) {
        await deviceRepo.create({
          serial: r.serial.trim(), type: typeOfAdd(r) as AssetType,
          ...ratioOf(ratioOfAdd(r)), model_desc: r.model.trim(),
          date_in: addDate || '', batch: addBatch.trim(), hold_for_note: addHold.trim(),
        });
        n++;
      }
      toast.success('Đã nhập kho', `${n} thiết bị.`);
      setModal(null);
      await load();
    } catch (e) {
      toast.error(`Dừng sau ${n} thiết bị`, pbErrorMessage(e));
      await load();
    } finally { setSaving(false); }
  };

  /* ------------------- gắn nhiều thiết bị vào điểm đo ------------------- */
  const [attachPoint, setAttachPoint] = useState('');
  const [attachDate, setAttachDate] = useState(today());

  const pickedRows = rows.filter(r => picked.has(r.device.id));
  const attach = async () => {
    if (!attachPoint) return toast.warning('Chưa chọn điểm đo', 'Phải chọn điểm đo để gắn.');
    setSaving(true);
    let n = 0;
    try {
      for (const r of pickedRows) {
        /*
          Tạo LẦN LẮP mới, không sửa lần lắp cũ: cùng một thiết bị có thể lắp
          rồi tháo rồi lắp lại nơi khác, mỗi lần là một dòng lịch sử riêng.
        */
        await assetRepo.create({
          serial: r.device.serial, type: r.device.type, device: r.device.id,
          point: attachPoint,
          ratio_primary: r.device.ratio_primary, ratio_secondary: r.device.ratio_secondary,
          date_on: attachDate || '', active: true, status: attachDate ? 'dang_treo' : 'kho',
        });
        // Đã có chỗ thật thì bỏ giữ chỗ, kẻo hai thông tin đá nhau.
        if (r.device.hold_point) await deviceRepo.update(r.device.id, { hold_point: '' });
        n++;
      }
      toast.success('Đã gắn vào điểm đo', `${n} thiết bị.`);
      setModal(null); setPicked(new Set());
      await load();
    } catch (e) {
      toast.error(`Dừng sau ${n} thiết bị`, pbErrorMessage(e));
      await load();
    } finally { setSaving(false); }
  };

  const del = async (r: StockRow) => {
    if (r.installCount > 0) {
      return toast.error('Không xóa được',
        `${r.device.serial} đã có ${r.installCount} lần lắp — xóa thiết bị sẽ mất lịch sử. `
        + 'Dùng Thanh lý nếu không dùng nữa.');
    }
    const ok = await confirm({
      title: 'Xóa thiết bị',
      message: `Xóa ${r.device.serial} khỏi kho? Thiết bị này chưa từng lắp ở đâu.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deviceRepo.remove(r.device.id);
      toast.success('Đã xóa', r.device.serial);
      await load();
    } catch (e) { toast.error('Không xóa được', pbErrorMessage(e)); }
  };

  const liquidate = async (r: StockRow) => {
    const ok = await confirm({
      title: r.device.liquidated_at ? 'Bỏ thanh lý' : 'Thanh lý thiết bị',
      message: r.device.liquidated_at
        ? `Đưa ${r.device.serial} trở lại kho?`
        : `Đánh dấu ${r.device.serial} đã thanh lý? Lịch sử lắp đặt vẫn giữ nguyên.`,
    });
    if (!ok) return;
    try {
      await deviceRepo.update(r.device.id, { liquidated_at: r.device.liquidated_at ? '' : today() });
      await load();
    } catch (e) { toast.error('Không lưu được', pbErrorMessage(e)); }
  };

  const pointOpts = (d?.points ?? [])
    .map(p => ({ value: p.id, label: p.code || p.line_name || p.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi', { numeric: true }));

  return (
    <div className="relative space-y-6">
      {dialog}

      {/* ---------------------- Đầu trang ---------------------- */}
      <div className="mb-2 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-bold text-ink">Kho vật tư</h2>
          <p className="mt-1 text-sm text-soft">
            Khai thiết bị trước, gắn điểm đo sau — hàng dự phòng, hàng dành sẵn, hàng tháo về kho
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <div className="relative w-full md:w-auto">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); }}
              placeholder="Tìm số No, loại, lô, nơi đang giữ..."
              className="w-full rounded-lg border border-[var(--border)] bg-surface py-2 pl-10 pr-4
                text-sm text-dim focus:outline-none focus:ring-1 focus:ring-accent sm:w-[260px]" />
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="vl-btn vl-btn-secondary flex items-center gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Nạp lại
          </button>
          {/* MỘT nút cho cả thêm lẻ lẫn nhập lô (dán Excel) — 28/09/2026. */}
          <button onClick={openAddMany}
            className="flex flex-1 items-center justify-center gap-2 vl-btn vl-btn-primary md:flex-none">
            <Plus className="h-5 w-5" /> Thêm mới
          </button>
        </div>
      </div>

      {/* ---------------------- Bộ lọc chip ---------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={!status} onClick={() => { setStatus(''); }}>
          Tất cả {rows.length}
        </Chip>
        {(['kho', 'dang_treo', 'thanh_ly'] as const).map(s => (
          <Chip key={s} on={status === s} onClick={() => { setStatus(status === s ? '' : s); }}>
            {DEVICE_STATUS_LABEL[s]} {count(s)}
          </Chip>
        ))}
      </div>

      {idleLong > 0 && (
        <div className="vl-alert vl-alert-light-warning text-[12px]">
          <b>Nhắc:</b> {idleLong} thiết bị nằm kho quá {IDLE_WARN_DAYS} ngày — mua về mà chưa lắp.
        </div>
      )}

      {/* ------------------- Thanh hành động hàng loạt ------------------- */}
      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-accent-soft px-4 py-3">
          <span className="text-[13px] font-bold text-blue-600">Đã chọn {picked.size} thiết bị</span>
          <button onClick={() => { setAttachPoint(''); setAttachDate(today()); setModal('attach'); }}
            className="vl-btn vl-btn-primary vl-btn-sm flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Gắn vào điểm đo
          </button>
          <button onClick={() => setPicked(new Set())} className="vl-btn vl-btn-secondary vl-btn-sm">
            Bỏ chọn
          </button>
        </div>
      )}

      {/* ---------------------------- Bảng ---------------------------- */}
      <ZoneTables groups={groups} unit="thiết bị" loading={loading} minWidth={1100}
        empty={rows.length ? 'Không có thiết bị nào khớp bộ lọc.' : 'Kho chưa có thiết bị nào.'}
        rowKey={r => r.device.id}
        columns={<>
          <th className={`${TH_CLS} w-[4%] pl-8`}>
            {/* Chọn TẤT CẢ dòng đang hiện sau bộ lọc, không riêng một thẻ KCN. */}
            <input type="checkbox" aria-label="Chọn tất cả"
              checked={shown.length > 0 && shown.every(r => picked.has(r.device.id))}
              onChange={e => setPicked(() => new Set(
                e.target.checked ? shown.map(r => r.device.id) : []))} />
          </th>
          <th className={`${TH_CLS} w-[18%]`}>Số No</th>
          <th className={`${TH_CLS} w-[13%]`}>Loại</th>
          <th className={`${TH_CLS} w-[9%]`}>Tỷ số</th>
          <th className={`${TH_CLS} w-[12%]`}>Trạng thái</th>
          <th className={`${TH_CLS} w-[19%]`}>Đang giữ cho</th>
          <th className={`${TH_CLS} w-[8%]`}>Lần lắp</th>
          <th className={`${TH_CLS} w-[9%]`}>Lô · ngày nhập</th>
          <th className={`${TH_CLS} w-[12%] pr-8 text-right`}>Thao tác</th>
        </>}
        renderRow={r => {
          const idle = idleDays(r, today());
          const row = (
            <tr key={r.device.id} className="transition-colors hover:bg-subtle/50">
              <td className="px-6 py-4 pl-8">
                <input type="checkbox" aria-label={`Chọn ${r.device.serial}`}
                  checked={picked.has(r.device.id)}
                  onChange={e => setPicked(s => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(r.device.id); else next.delete(r.device.id);
                    return next;
                  })} />
              </td>
              <td className="truncate px-6 py-4 font-mono text-sm font-bold text-ink" title={r.device.serial}>
                {r.device.serial}
              </td>
              <td className="px-6 py-4 text-sm text-soft">{ASSET_LABEL[r.device.type]}</td>
              <td className="px-6 py-4 font-mono text-xs text-soft">
                {r.device.ratio_primary != null ? `${r.device.ratio_primary}/${r.device.ratio_secondary ?? ''}` : '—'}
              </td>
              <td className="px-6 py-4">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_CLS[r.status || 'kho']}`}>
                  {DEVICE_STATUS_LABEL[r.status || 'kho']}
                </span>
                {r.status === 'kho' && idle > IDLE_WARN_DAYS && (
                  <div className="mt-1 text-[11px] text-warn">nằm kho {idle} ngày</div>
                )}
              </td>
              {/* Cột user yêu cầu: hàng giữ chỗ vẫn nằm chung danh sách kho. */}
              <td className="truncate px-6 py-4 text-sm text-soft" title={holdText(r)}>
                {r.status === 'dang_treo'
                  ? <span className="font-mono text-[12px] text-dim">{r.atPoint?.code ?? '—'}</span>
                  : (holdText(r) || <span className="text-faint">—</span>)}
              </td>
              {/* Vòng đời: bấm để xem từng lần lắp — thay cho màn riêng cũ. */}
              <td className="px-6 py-4">
                {r.installCount === 0
                  ? <span className="text-[12px] text-faint">chưa lắp</span>
                  : (
                    <button type="button"
                      onClick={() => setOpenRow(openRow === r.device.id ? null : r.device.id)}
                      className="flex items-center gap-1 text-[12px] font-bold text-blue-600 hover:underline">
                      {openRow === r.device.id
                        ? <ChevronDown className="h-3.5 w-3.5" />
                        : <ChevronRight className="h-3.5 w-3.5" />}
                      {r.installCount} lần
                      {r.installCount >= REUSE_MIN && <Recycle className="h-3.5 w-3.5" />}
                    </button>
                  )}
              </td>
              <td className="px-6 py-4 text-[12px] text-soft">
                {r.device.batch || '—'}
                <div className="text-faint">{dmy(r.device.date_in) || ''}</div>
              </td>
              <td className="px-6 py-4 pr-8 text-right">
                <div className="flex justify-end gap-2">
                  <button onClick={() => void liquidate(r)}
                    title={r.device.liquidated_at ? 'Bỏ thanh lý' : 'Thanh lý'}
                    className="rounded p-2 text-soft transition-colors hover:bg-accent-soft hover:text-blue-600">
                    <PackageOpen className="h-5 w-5" />
                  </button>
                  <button onClick={() => openEdit(r.device)} title="Sửa"
                    className="rounded p-2 text-soft transition-colors hover:bg-accent-soft hover:text-blue-600">
                    <Edit2 className="h-5 w-5" />
                  </button>
                  <button onClick={() => void del(r)} title="Xóa"
                    className="rounded p-2 text-soft transition-colors hover:bg-[var(--danger-soft)] hover:text-red-500">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          );
          /*
            Hàng mở rộng = VÒNG ĐỜI của thiết bị: từng lần lắp ở đâu, từ ngày
            nào tới ngày nào. Nội dung này trước nằm ở màn "Luân chuyển vật tư"
            riêng; để cạnh chính dòng thiết bị thì không phải nhớ sang màn nào.
          */
          const history = openRow === r.device.id && (
            <tr key={`${r.device.id}-lc`} className="bg-subtle/40">
              <td />
              <td colSpan={7} className="px-6 py-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-faint">
                  <Recycle className="h-3.5 w-3.5" /> Vòng đời
                </div>
                <div className="space-y-1">
                  {r.installs.map((x, i) => (
                    <div key={i} className="flex items-center gap-3 text-[12px]">
                      <span className="w-5 text-faint">{i + 1}.</span>
                      <span className="font-mono text-dim">{x.point?.code ?? '(điểm đo đã xóa)'}</span>
                      <span className="text-soft">
                        {dmy(x.from)} → {x.to ? dmy(x.to) : <b className="text-emerald-600">đang treo</b>}
                      </span>
                    </div>
                  ))}
                  {r.status === 'kho' && r.lastOff && (
                    <div className="flex items-center gap-3 pt-1 text-[12px] text-warn">
                      <span className="w-5" />
                      nằm kho từ {dmy(r.lastOff)} — {idleDays(r, today())} ngày
                    </div>
                  )}
                </div>
              </td>
            </tr>
          );
          return history ? [row, history] : row;
        }} />

      {/* ===================== Thêm mới (lẻ + theo lô) ===================== */}
      <FormModal open={modal === 'add'} title="Thêm vật tư vào kho" wide
        onClose={() => setModal(null)} onSubmit={() => void saveAdd()} saving={saving}
        submitLabel={addReady.length ? `Ghi ${addReady.length} thiết bị` : 'Chưa có gì để ghi'}>
        {/* Ô CHUNG: mặc định cho mọi dòng để trống loại / tỷ số. */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Loại chung" hint="Dòng nào chọn loại riêng thì theo dòng đó">
            <Select value={addType} onChange={v => setAddType(v as AssetType)}
              options={TYPES.map(t => ({ value: t, label: ASSET_LABEL[t] }))} placeholder="Chọn loại" />
          </Field>
          <Field label="Tỷ số chung" hint="Cho TI / TU — dòng có tỷ số riêng thì theo dòng">
            <TextInput value={addRatio} onChange={setAddRatio} mono placeholder="200/5" />
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
            Dòng đã có trong kho được bỏ qua, không ghi đè.
          </p>
        </div>
      </FormModal>

      {/* ===================== Khai một thiết bị ===================== */}
      <FormModal open={modal === 'one'} title={editing ? 'Sửa thiết bị' : 'Thêm thiết bị vào kho'}
        onClose={() => setModal(null)} onSubmit={() => void saveOne()} saving={saving}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Số No" required hint="8–20 chữ số">
            <CellInput value={form.serial} mono
              onChange={v => {
                const guess = guessType(v);
                setForm(f => ({ ...f, serial: v, type: guess ?? f.type }));
              }} />
          </Field>
          <Field label="Loại" required>
            <Select value={form.type} onChange={v => setForm(f => ({ ...f, type: v as AssetType }))}
              options={TYPES.map(t => ({ value: t, label: ASSET_LABEL[t] }))} placeholder="Chọn loại" />
          </Field>
          {HAS_RATIO.includes(form.type as AssetType) && (
            <Field label="Tỷ số" required hint="Không có tỷ số thì không suy được HSN">
              <TextInput value={form.ratio} onChange={v => setForm(f => ({ ...f, ratio: v }))}
                mono placeholder="200/5" />
            </Field>
          )}
          <Field label="Model / mô tả">
            <TextInput value={form.model_desc} onChange={v => setForm(f => ({ ...f, model_desc: v }))} />
          </Field>
          <Field label="Ngày nhập kho">
            <input type="date" value={form.date_in}
              onChange={e => setForm(f => ({ ...f, date_in: e.target.value }))} className={INPUT_CLS} />
          </Field>
          <Field label="Mã lô">
            <TextInput value={form.batch} onChange={v => setForm(f => ({ ...f, batch: v }))} />
          </Field>
          <Field label="Dành cho" hint="Khách hàng, nhà máy, hoặc mục đích — gõ tự do">
            <TextInput value={form.hold_for_note}
              onChange={v => setForm(f => ({ ...f, hold_for_note: v }))}
              placeholder="Nhà máy X, lô B3" />
          </Field>
          <Field label="Ghi chú">
            <TextInput value={form.note} onChange={v => setForm(f => ({ ...f, note: v }))} />
          </Field>
        </div>
      </FormModal>

      {/* ================= Gắn nhiều thiết bị vào điểm đo ================= */}
      <FormModal open={modal === 'attach'} title={`Gắn ${picked.size} thiết bị vào điểm đo`}
        onClose={() => setModal(null)} onSubmit={() => void attach()} saving={saving}
        submitLabel="Gắn vào điểm đo">
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-subtle px-4 py-3 text-[12px] text-soft">
          {pickedRows.map(r => (
            <div key={r.device.id} className="font-mono">
              {r.device.serial} · {ASSET_LABEL[r.device.type]}
              {r.device.ratio_primary != null && ` · ${r.device.ratio_primary}/${r.device.ratio_secondary}`}
            </div>
          ))}
        </div>
        <Field label="Điểm đo" required>
          <Select value={attachPoint} onChange={setAttachPoint} options={pointOpts}
            placeholder="Chọn điểm đo" searchable />
        </Field>
        <Field label="Ngày treo"
          hint="Bỏ trống nếu chưa lắp thật — khi đó chỉ là giữ chỗ, vật tư vẫn tính là trong kho">
          <input type="date" value={attachDate} onChange={e => setAttachDate(e.target.value)}
            className={INPUT_CLS} />
        </Field>
      </FormModal>
    </div>
  );
}
