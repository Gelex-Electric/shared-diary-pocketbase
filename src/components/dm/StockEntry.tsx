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
  Plus, RefreshCw, Trash2, Edit2, Link2, PackageOpen, Search,
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
import AddStockModal, { SHAPE_OPTS } from './AddStockModal';
import { groupByZone, sortByCode } from './groupByZone';
import {
  devices as deviceRepo, loadCatalog, pbErrorMessage, isAbortError,
  type CatalogData,
} from '../../lib/dm/repo';
import {
  ASSET_LABEL, DEFAULT_TI_SHAPE, DEVICE_STATUS_LABEL, SHAPE_LABEL, type AssetType, type Device, type DeviceStatus,
  type TiShape,
} from '../../lib/dm/types';
import { pointZoneId } from '../../lib/dm/pointScope';
import { planAttach } from '../../lib/dm/attach';
import { runAttach } from '../../lib/dm/attachRun';
import {
  buildStock, guessType, idleDays, SERIAL_RE,
  IDLE_WARN_DAYS, REUSE_MIN, type StockRow,
} from '../../lib/dm/stock';
import type { Point } from '../../lib/dm/types';
import { buildTerms, matchesTerms } from '../../lib/dm/search';
import { dmy } from '../../lib/dm/lifecycle';

const TYPES: AssetType[] = ['CONGTO', 'TI', 'TU', 'GP03', 'SIM', 'KHAC'];
/** Loại có tỷ số — chỉ hai loại này mới hiện ô tỷ số, giống form điểm đo. */
const HAS_RATIO: AssetType[] = ['TI', 'TU'];
const today = () => new Date().toISOString().slice(0, 10);

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
  /** Lọc theo loại vật tư (user yêu cầu 23/10/2026). `''` = mọi loại. */
  const [typeFilter, setTypeFilter] = useState<AssetType | ''>('');
  /** Lọc hình dạng — chỉ hiện khi đang lọc TI. `none` = TI chưa khai hình dạng. */
  const [shapeFilter, setShapeFilter] = useState<TiShape | 'none' | ''>('');
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
    if (typeFilter && r.device.type !== typeFilter) return false;
    if (typeFilter === 'TI' && shapeFilter
      && (shapeFilter === 'none' ? !!r.device.shape : r.device.shape !== shapeFilter)) return false;
    // Loại vẫn đưa vào chuỗi tìm để gõ "TI" hay "GP-03" là ra.
    return matchesTerms(
      [r.device.serial, ASSET_LABEL[r.device.type], r.device.batch, holdText(r),
        r.atPoint?.code, r.device.note], terms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rows, status, typeFilter, shapeFilter, terms, d]);

  /**
   * Gom theo KCN rồi mỗi KCN một thẻ — cùng khuôn bảng Điểm đo (user chốt
   * 28/08/2026). Trong mỗi thẻ xếp theo số No để mắt dò xuôi được.
   */
  const groups = useMemo(
    () => groupByZone(sortByCode(shown, r => r.device.serial), r => r.zoneId, d?.zones ?? []),
    [shown, d]);

  /** Đếm chéo: số ở ô Trạng thái theo loại đang lọc, số ở ô Loại theo trạng thái đang lọc. */
  const ofType = typeFilter ? rows.filter(r => r.device.type === typeFilter) : rows;
  const ofStatus = status ? rows.filter(r => r.status === status) : rows;
  const count = (s: DeviceStatus) => ofType.filter(r => r.status === s).length;
  const countType = (t: AssetType) => ofStatus.filter(r => r.device.type === t).length;
  /** Chỉ liệt kê loại có trong kho — mục 0 thiết bị chỉ làm rối. */
  const typesInStock = TYPES.filter(t => rows.some(r => r.device.type === t));
  const idleLong = rows.filter(r => r.status === 'kho' && idleDays(r, today()) > IDLE_WARN_DAYS).length;

  /* ------------------------- khai một thiết bị ------------------------- */
  const EMPTY = {
    serial: '', type: '' as AssetType | '', ratio: '', shape: DEFAULT_TI_SHAPE as TiShape | '', model_desc: '',
    hold_for_note: '', date_in: today(), batch: '', note: '',
  };
  const [form, setForm] = useState(EMPTY);

  const openEdit = (dev: Device) => {
    setEditing(dev);
    setForm({
      serial: dev.serial, type: dev.type, model_desc: dev.model_desc ?? '', shape: dev.shape ?? '',
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
      shape: form.type === 'TI' ? form.shape : '',
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
  /* Hộp đã tách ra `AddStockModal` (26/10/2026) để màn Đặt mua dùng lại khi nhận hàng. */
  const openAddMany = () => setModal('add');

  /* ------------------- gắn nhiều thiết bị vào điểm đo ------------------- */
  const [attachPoint, setAttachPoint] = useState('');
  const [attachDate, setAttachDate] = useState(today());

  const pickedRows = rows.filter(r => picked.has(r.device.id));

  /*
    LUẬT GẮN HÀNG LOẠT (13/10/2026) — trước đây nút này ghi thẳng, bỏ qua mọi
    luật của form điểm đo: gắn được thiết bị đang treo nơi khác (một thiết bị
    treo hai chỗ), không kiểm HSN, không gỡ dòng dự kiến ở điểm đo cũ.
    Nay cùng luật với form:
      - CHẶN: đã thanh lý · đang treo (ở nơi khác hoặc chính điểm đo này) ·
        đã có dòng ở điểm đo này · TI chọn khác tỷ số nhau · TI×TU ≠ HSN điểm đo.
      - CHUYỂN: thiết bị đang DỰ KIẾN ở điểm đo khác ⇒ gỡ dòng bên đó khi ghi
        (giống luật nới ngày 13/10 ở form điểm đo).
  */
  const assetsOf = (devId: string) => (d?.assets ?? []).filter(a => a.device === devId);
  const isPlan = (a: { date_on?: string; date_off?: string }) =>
    !(a.date_on ?? '').slice(0, 10) && !(a.date_off ?? '').slice(0, 10);
  const codeOfPoint = (id?: string) => d?.points.find(p => p.id === id)?.code ?? '(không rõ)';
  const { blocks: attachBlocks, moves: attachMoves } = useMemo(
    () => planAttach(pickedRows.map(r => r.device), attachPoint,
      { assets: d?.assets ?? [], points: d?.points ?? [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picked, attachPoint, d]);

  const attach = async () => {
    if (!attachPoint) return toast.warning('Chưa chọn điểm đo', 'Phải chọn điểm đo để gắn.');
    if (attachBlocks.length) return toast.error('Chưa gắn được', `${attachBlocks.join('. ')}.`);
    setSaving(true);
    let n = 0;
    try {
      await runAttach(pickedRows.map(r => r.device), attachPoint, attachDate, attachMoves,
        'Gắn từ Kho vật tư', k => { n = k; });
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
    /*
      Không thanh lý thiết bị CÒN Ở ĐIỂM ĐO (13/10/2026): đang treo thì nó vẫn
      đang đo — "đã thanh lý mà đang treo" là hai sự thật đá nhau; đang dự kiến
      thì dòng ở điểm đo kia sẽ trỏ vào một thiết bị đã bỏ. Tháo / gỡ trước.
    */
    if (!r.device.liquidated_at) {
      if (r.status === 'dang_treo') {
        return toast.error('Chưa thanh lý được',
          `${r.device.serial} đang treo ở ${r.atPoint?.code ?? '(không rõ)'} — khai ngày tháo ở điểm đo đó trước.`);
      }
      const plan = assetsOf(r.device.id).find(isPlan);
      if (plan) {
        return toast.error('Chưa thanh lý được',
          `${r.device.serial} đang dự kiến cho ${codeOfPoint(plan.point)} — bỏ dòng đó ở điểm đo trước.`);
      }
    }
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

      {/* ---- Bộ lọc: Trạng thái + Loại, hai ô chọn chung một dòng (user chốt 23/10/2026) ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-[220px]">
          <Select label="Trạng thái" value={status}
            onChange={v => setStatus(v as DeviceStatus | '')}
            options={[
              { value: '', label: `Tất cả trạng thái (${ofType.length})` },
              ...(['kho', 'dang_treo', 'thanh_ly'] as const).map(st => ({
                value: st, label: `${DEVICE_STATUS_LABEL[st]} (${count(st)})`,
              })),
            ]} />
        </div>
        <div className="w-full sm:w-[220px]">
          <Select label="Loại vật tư" value={typeFilter}
            onChange={v => { setTypeFilter(v as AssetType | ''); setShapeFilter(''); }}
            options={[
              { value: '', label: `Tất cả loại (${ofStatus.length})` },
              ...typesInStock.map(t => ({ value: t, label: `${ASSET_LABEL[t]} (${countType(t)})` })),
            ]} />
        </div>
        {typeFilter === 'TI' && (
          <div className="w-full sm:w-[220px]">
            <Select label="Hình dạng TI" value={shapeFilter}
              onChange={v => setShapeFilter(v as TiShape | 'none' | '')}
              options={[
                { value: '', label: 'Mọi hình dạng' },
                ...(Object.keys(SHAPE_LABEL) as TiShape[]).map(sh => ({ value: sh, label: SHAPE_LABEL[sh] })),
                { value: 'none', label: 'Chưa rõ hình dạng' },
              ]} />
          </div>
        )}
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
              <td className="px-6 py-4 text-sm text-soft">
                {ASSET_LABEL[r.device.type]}
                {r.device.type === 'TI' && r.device.shape && ` · ${SHAPE_LABEL[r.device.shape]}`}
              </td>
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
      <AddStockModal open={modal === 'add'} onClose={() => setModal(null)} devices={d?.devices ?? []}
        onSaved={async created => { if (created.length) setModal(null); await load(); }} />

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
          {form.type === 'TI' && (
            <Field label="Hình dạng" hint="Kinh Doanh khai nhu cầu theo tròn / vuông">
              <Select value={form.shape} onChange={v => setForm(f => ({ ...f, shape: v as TiShape | '' }))}
                options={SHAPE_OPTS} />
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
          <DatePicker value={attachDate} onChange={setAttachDate} usePortal />
        </Field>
        {attachMoves.length > 0 && (
          <div className="vl-alert vl-alert-light-warning text-[12px]">
            Khi gắn sẽ <b>CHUYỂN</b> về đây, gỡ khỏi điểm đo cũ và ghi sổ mượn:{' '}
            {attachMoves.map(m => `${m.serial} (đang dự kiến ở ${m.fromCode})`).join('; ')}.
          </div>
        )}
        {attachBlocks.length > 0 && (
          <div className="vl-alert vl-alert-light-danger text-[12px]">
            <b>Không gắn được:</b> {attachBlocks.join('; ')}.
          </div>
        )}
      </FormModal>
    </div>
  );
}
