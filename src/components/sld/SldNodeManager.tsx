// ===================================================================
// SldNodeManager — UI BẢNG quản lý cây thiết bị `sld_node` (PocketBase).
// Sửa bảng (thêm/sửa/xoá node) → sơ đồ một sợi (EngineeringSld) TỰ VẼ LẠI.
//
// Nguyên tắc:
//  - Nguồn dữ liệu duy nhất = collection `sld_node`. Bảng và sơ đồ cùng đọc nó.
//  - KHÔNG lưu toạ độ (ELK tự layout). Chỉ lưu cấu trúc cha-con + thuộc tính.
//  - Quyền ghi theo KCN (zone) — khớp updateRule PB (area2="" = admin sửa tất cả).
//  - Dữ liệu sld_node THUỘC VỀ user: chỉ ghi field user chủ động sửa, không auto-đè.
// ===================================================================
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, Lock, X } from 'lucide-react';
import { pb } from '../../lib/pocketbase';
import {
  fetchSldNodes, fetchSldStationKeys, childrenOf,
  SldNodeRec, SldNodeType,
} from '../../lib/sldNodes';
import { fetchMeterInfo, MeterInfoRow } from '../../lib/meterInfo';
import { Select } from '../ui/Select';
import ConfirmDialog from '../ui/ConfirmDialog';
import { toast } from '../../lib/toast';
import EngineeringSld from './EngineeringSld';

const TYPE_OPTS: { value: SldNodeType; label: string }[] = [
  { value: 'source', label: 'Nguồn / tủ trung thế' },
  { value: 'busbar', label: 'Thanh cái' },
  { value: 'transformer', label: 'Máy biến áp' },
  { value: 'breaker', label: 'Máy cắt (ACB/MCCB)' },
  { value: 'disconnector', label: 'Dao cách ly' },
  { value: 'earth', label: 'Dao tiếp địa' },
  { value: 'meter', label: 'Điểm đo (công tơ)' },
  { value: 'feeder', label: 'Lộ ra (feeder)' },
];
const TYPE_LABEL = Object.fromEntries(TYPE_OPTS.map(o => [o.value, o.label]));

/** Quyền ghi theo zone (khớp updateRule PB). area2 rỗng = admin sửa tất cả. */
function canEditZone(zone: string): boolean {
  const area2 = (pb.authStore.model as { area2?: string } | null)?.area2 ?? '';
  if (!pb.authStore.isValid) return false;
  if (area2 === '') return true;
  return (zone || '').includes(area2) || area2.includes(zone || '');
}

/** Form 1 node (thêm hoặc sửa). */
interface NodeForm {
  type: SldNodeType;
  kind: string;
  label: string;
  parent: string;      // id node cha ('' = gốc)
  order_index: string; // giữ chuỗi cho input, parse khi lưu
  meter_no: string;
  enclosure: string;
}
const EMPTY_FORM: NodeForm = {
  type: 'busbar', kind: '', label: '', parent: '', order_index: '0', meter_no: '', enclosure: '',
};

export default function SldNodeManager() {
  const [stationKeys, setStationKeys] = useState<string[]>([]);
  const [selKey, setSelKey] = useState<string>('');
  const [rows, setRows] = useState<SldNodeRec[]>([]);
  const [meters, setMeters] = useState<MeterInfoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);   // bump → EngineeringSld remount + refetch

  // Form thêm/sửa
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<NodeForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Tạo trạm mới
  const [newKey, setNewKey] = useState('');
  const [newZone, setNewZone] = useState('');

  // Xoá
  const [delId, setDelId] = useState<string | null>(null);

  const zone = useMemo(() => rows[0]?.zone ?? newZone, [rows, newZone]);
  const editable = useMemo(() => canEditZone(zone || newZone), [zone, newZone]);

  const loadKeys = useCallback(async () => {
    try {
      const keys = [...(await fetchSldStationKeys())].sort();
      setStationKeys(keys);
      if (!selKey && keys.length) setSelKey(keys[0]);
    } catch (e) { console.error(e); toast.error('Không tải được danh sách trạm'); }
  }, [selKey]);

  const loadRows = useCallback(async (key: string) => {
    if (!key) { setRows([]); return; }
    setLoading(true);
    try {
      setRows(await fetchSldNodes(key));
    } catch (e) { console.error(e); toast.error('Không tải được cây thiết bị'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadKeys(); fetchMeterInfo().then(setMeters).catch(() => {}); }, [loadKeys]);
  useEffect(() => { loadRows(selKey); }, [selKey, loadRows]);

  /** Refetch bảng + báo sơ đồ vẽ lại. */
  const refresh = useCallback(async () => {
    await loadRows(selKey);
    setVersion(v => v + 1);
  }, [loadRows, selKey]);

  // ---------- Tạo trạm mới ----------
  async function createStation() {
    const key = newKey.trim();
    if (!key) { toast.warning('Nhập station_key (vd YM.TITAN.NX9)'); return; }
    if (stationKeys.includes(key)) { toast.warning('station_key đã tồn tại'); return; }
    if (!canEditZone(newZone)) { toast.error('Bạn không có quyền tạo trạm cho KCN này'); return; }
    setStationKeys(k => [...k, key].sort());
    setSelKey(key);
    setRows([]);
    setNewKey('');
    toast.info('Đã chọn trạm mới — thêm node gốc (nguồn/thanh cái) để bắt đầu');
  }

  // ---------- Thêm / sửa node ----------
  function openAdd() {
    setEditId(null);
    setForm({ ...EMPTY_FORM, order_index: String(rows.length) });
    setShowForm(true);
  }
  function openEdit(r: SldNodeRec) {
    setEditId(r.id);
    setForm({
      type: r.type, kind: r.kind ?? '', label: r.label ?? '', parent: r.parent ?? '',
      order_index: String(r.order_index ?? 0), meter_no: r.meter_no ?? '', enclosure: r.enclosure ?? '',
    });
    setShowForm(true);
  }

  async function saveNode() {
    if (!selKey) return;
    if (!editable) { toast.error('Không có quyền ghi cho KCN này'); return; }
    // chặn tự-vòng lặp: parent không được là chính nó
    if (editId && form.parent === editId) { toast.error('Node không thể là cha của chính nó'); return; }
    const payload = {
      station_key: selKey,
      zone: zone || newZone,
      type: form.type,
      kind: form.kind.trim() || undefined,
      label: form.label.trim() || undefined,
      order_index: Number(form.order_index) || 0,
      meter_no: form.meter_no.trim() || undefined,
      parent: form.parent || undefined,
      enclosure: form.enclosure.trim() || undefined,
    };
    setSaving(true);
    try {
      if (editId) await pb.collection('sld_node').update(editId, payload);
      else await pb.collection('sld_node').create(payload);
      toast.success(editId ? 'Đã cập nhật node' : 'Đã thêm node');
      setShowForm(false);
      await refresh();
      loadKeys();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Lưu thất bại (kiểm tra quyền/kết nối)');
    } finally { setSaving(false); }
  }

  async function deleteNode(id: string) {
    // con trực tiếp phải xử lý trước (tránh mồ côi)
    const kids = childrenOf(rows, id);
    if (kids.length) {
      toast.warning(`Node còn ${kids.length} node con — xoá/di chuyển node con trước`);
      setDelId(null);
      return;
    }
    try {
      await pb.collection('sld_node').delete(id);
      toast.success('Đã xoá node');
      await refresh();
      loadKeys();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Xoá thất bại');
    } finally { setDelId(null); }
  }

  const parentLabel = (pid?: string) => {
    if (!pid) return '— (gốc)';
    const p = rows.find(r => r.id === pid);
    return p ? (p.label || TYPE_LABEL[p.type] || pid) : pid;
  };

  const parentOpts = useMemo(() => [
    { value: '', label: '— (gốc, không có cha)' },
    ...rows.filter(r => r.id !== editId).map(r => ({
      value: r.id, label: `${r.label || TYPE_LABEL[r.type]} (${TYPE_LABEL[r.type]})`,
    })),
  ], [rows, editId]);

  return (
    <div className="flex h-full min-h-[480px]">
      {/* ---------------- TRÁI: bảng CRUD ---------------- */}
      <div className="w-[46%] min-w-[380px] max-w-[620px] flex flex-col border-r border-[var(--border)] overflow-hidden">
        {/* Chọn / tạo trạm */}
        <div className="px-3 py-2.5 border-b border-[var(--border)] flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Select
              className="flex-1"
              value={selKey}
              onChange={setSelKey}
              options={stationKeys.map(k => ({ value: k, label: k }))}
              placeholder="Chọn trạm (station_key)"
              searchable
            />
            <button
              onClick={refresh}
              className="p-2 rounded-lg border border-[var(--border)] text-soft hover:text-ink"
              title="Tải lại"
            ><RefreshCw className="w-4 h-4" /></button>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={newKey}
              onChange={e => setNewKey(e.target.value)}
              placeholder="station_key mới (vd YM.DEMO.T1)"
              className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink"
            />
            <input
              value={newZone}
              onChange={e => setNewZone(e.target.value)}
              placeholder="zone (vd KCNYM)"
              className="w-28 px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink"
            />
            <button
              onClick={createStation}
              className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg bg-accent text-white"
            ><Plus className="w-4 h-4" /> Trạm</button>
          </div>
        </div>

        {/* Thanh thao tác */}
        <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-xs text-soft">
            {selKey ? `${rows.length} node · ${zone || '—'}` : 'Chưa chọn trạm'}
            {!editable && selKey && <span className="ml-2 inline-flex items-center gap-1 text-amber-600"><Lock className="w-3 h-3" /> chỉ đọc</span>}
          </span>
          <button
            onClick={openAdd}
            disabled={!selKey || !editable}
            className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg bg-accent text-white disabled:opacity-40"
          ><Plus className="w-4 h-4" /> Thêm node</button>
        </div>

        {/* Bảng node */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-soft">Đang tải…</div>
          ) : rows.length === 0 ? (
            <div className="p-4 text-sm text-soft">Chưa có node. Bấm “Thêm node” để tạo (bắt đầu bằng nguồn/thanh cái, parent = gốc).</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--card)] text-soft text-xs">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-2 py-1.5 text-left w-10">#</th>
                  <th className="px-2 py-1.5 text-left">Loại · nhãn</th>
                  <th className="px-2 py-1.5 text-left">Cha</th>
                  <th className="px-2 py-1.5 text-left w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-[var(--border)] hover:bg-[var(--hover)]">
                    <td className="px-2 py-1.5 text-soft tabular-nums">{r.order_index ?? 0}</td>
                    <td className="px-2 py-1.5">
                      <div className="text-ink">{r.label || <span className="text-soft italic">({TYPE_LABEL[r.type]})</span>}</div>
                      <div className="text-[11px] text-soft">
                        {TYPE_LABEL[r.type]}{r.kind ? ` · ${r.kind}` : ''}{r.meter_no ? ` · ${r.meter_no}` : ''}
                        {r.enclosure ? ` · ⬚ ${r.enclosure}` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-soft">{parentLabel(r.parent)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(r)} disabled={!editable}
                          className="p-1.5 rounded text-soft hover:text-ink disabled:opacity-30" title="Sửa">
                          <Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setDelId(r.id)} disabled={!editable}
                          className="p-1.5 rounded text-soft hover:text-red-500 disabled:opacity-30" title="Xoá">
                          <Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ---------------- PHẢI: sơ đồ sống ---------------- */}
      <div className="flex-1 min-w-0">
        {selKey ? (
          <EngineeringSld
            key={`${selKey}-${version}`}
            stationKey={selKey}
            meters={meters}
            busy={false}
            onToggle={() => {}}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-soft text-sm">
            Chọn hoặc tạo một trạm để xem sơ đồ.
          </div>
        )}
      </div>

      {/* ---------------- Form thêm/sửa (overlay) ---------------- */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowForm(false)}>
          <div className="bg-[var(--card)] rounded-xl border border-[var(--border)] w-[440px] max-w-[92vw] p-4 flex flex-col gap-3"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">{editId ? 'Sửa node' : 'Thêm node'}</h3>
              <button onClick={() => setShowForm(false)} className="text-soft hover:text-ink"><X className="w-4 h-4" /></button>
            </div>

            <label className="text-xs text-soft">Loại thiết bị
              <div className="mt-1"><Select value={form.type} onChange={v => setForm(f => ({ ...f, type: v as SldNodeType }))} options={TYPE_OPTS} /></div>
            </label>

            <label className="text-xs text-soft">Node cha
              <div className="mt-1"><Select value={form.parent} onChange={v => setForm(f => ({ ...f, parent: v }))} options={parentOpts} searchable /></div>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-soft">Nhãn
                <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink" />
              </label>
              <label className="text-xs text-soft">Thứ tự (order_index)
                <input type="number" value={form.order_index} onChange={e => setForm(f => ({ ...f, order_index: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink" />
              </label>
              <label className="text-xs text-soft">kind (acb/mccb/kios…)
                <input value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink" />
              </label>
              <label className="text-xs text-soft">meter_no (nếu là điểm đo)
                <input value={form.meter_no} onChange={e => setForm(f => ({ ...f, meter_no: e.target.value }))}
                  className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink" />
              </label>
            </div>

            <label className="text-xs text-soft">Khung tủ (enclosure — tùy chọn)
              <input value={form.enclosure} onChange={e => setForm(f => ({ ...f, enclosure: e.target.value }))}
                placeholder="vd Tủ MSB NX9"
                className="mt-1 w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border)] bg-transparent text-ink" />
            </label>

            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-soft">Huỷ</button>
              <button onClick={saveNode} disabled={saving}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white disabled:opacity-50">
                {saving ? 'Đang lưu…' : (editId ? 'Cập nhật' : 'Thêm')}</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!delId}
        title="Xoá node"
        message="Xoá node này khỏi cây thiết bị? Hành động không hoàn tác."
        variant="danger"
        onConfirm={() => delId && deleteNode(delId)}
        onCancel={() => setDelId(null)}
      />
    </div>
  );
}
