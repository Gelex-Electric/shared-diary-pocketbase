import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS, ID_TO_AREA } from '../lib/pocketbase';
import { ElectricShift } from '../types';
import { Plus, Trash2, Edit2, X, Check, Search, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Select } from './ui/Select';
import { useConfirm } from './ui/ConfirmDialog';

export default function ElectricShiftManager() {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [shifts, setShifts] = useState<ElectricShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterArea, setFilterArea] = useState('');
  
  // New/Edit State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    IDnum: 1,
    Name: '',
    area: AREAS[0]
  });

  // User areas handling - stabilize with JSON stringification for dependency tracking
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    const areas = Array.isArray(raw) 
      ? raw 
      : (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
    return areas;
  }, [JSON.stringify(pb.authStore.model?.area)]);
  
  const effectiveAreas = React.useMemo(() => userAreas.length > 0 ? userAreas : AREAS, [userAreas]);

  const loadShifts = useCallback(async () => {
    setIsLoading(true);
    try {
      const filterParts: string[] = [];
      if (filterArea) {
        filterParts.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        const areaFilters = userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ');
        filterParts.push(`(${areaFilters})`);
      }

      const result = await pb.collection('Electric_shift').getFullList<ElectricShift>({
        filter: filterParts.join(' && '),
        sort: 'IDnum',
        requestKey: null
      });
      setShifts(result);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('Error loading shifts:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, userAreas]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({
      IDnum: shifts.length > 0 ? Math.max(...shifts.map(s => s.IDnum || 0)) + 1 : 1,
      Name: '',
      area: effectiveAreas[0] || AREAS[0]
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (shift: ElectricShift) => {
    setEditingId(shift.id);
    setFormData({
      IDnum: shift.IDnum,
      Name: shift.Name,
      area: shift.area
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.Name) {
      alert('Vui lòng điền họ tên!');
      return;
    }

    try {
      if (editingId) {
        await pb.collection('Electric_shift').update(editingId, formData);
      } else {
        await pb.collection('Electric_shift').create(formData);
      }
      setIsModalOpen(false);
      loadShifts();
    } catch (err) {
      console.error('Error saving shift personnel:', err);
      alert('Có lỗi xảy ra khi lưu thông tin.');
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Xóa nhân sự?', message: 'Nhân sự này sẽ bị xóa vĩnh viễn.', confirmLabel: 'Xóa', variant: 'danger' });
    if (!ok) return;
    try {
      await pb.collection('Electric_shift').delete(id);
      loadShifts();
    } catch (err) {
      console.error('Error deleting shift personnel:', err);
      alert('Có lỗi xảy ra khi xóa nhân sự.');
    }
  };

  return (
    <div className="space-y-8 relative">
      {confirmDialog}
      {/* Header and top filters */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-ink">Quản lý nhân sự trực</h2>
          <p className="text-soft text-sm mt-1">Danh sách nhân sự phân bổ theo tổ vận hành</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <Select
            value={filterArea}
            onChange={setFilterArea}
            options={[{ value: '', label: 'Tất cả khu vực' }, ...effectiveAreas.map(area => ({ value: area, label: area }))]}
            className="min-w-[180px]"
          />
          <button 
            onClick={handleOpenAdd}
            className="vl-btn vl-btn-primary flex-1 md:flex-none flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Thêm nhân sự
          </button>
        </div>
      </div>

      {/* Grid List */}
      <div className="vl-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-6 py-4 text-[10px] font-bold text-faint uppercase tracking-widest pl-10 w-24">Số thứ tự</th>
                <th className="px-6 py-4 text-[10px] font-bold text-faint uppercase tracking-widest">Họ & Tên</th>
                <th className="px-6 py-4 text-[10px] font-bold text-faint uppercase tracking-widest">Khu vực</th>
                <th className="px-6 py-4 text-[10px] font-bold text-faint uppercase tracking-widest text-right pr-10 w-32">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-faint">
                    <div className="flex justify-center items-center gap-3">
                      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải danh sách...</span>
                    </div>
                  </td>
                </tr>
              ) : shifts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-faint italic">
                    Chưa có nhân sự trực nào được ghi nhận.
                  </td>
                </tr>
              ) : (
                shifts.map((shift) => (
                  <tr key={shift.id} className="hover:bg-subtle/50 transition-colors">
                    <td className="px-6 py-4 pl-10">
                      <span className="font-mono text-xs font-bold text-soft bg-subtle px-2.5 py-1 rounded-md">{shift.IDnum}</span>
                    </td>
                    <td className="px-6 py-4 font-bold text-ink">{shift.Name}</td>
                    <td className="px-6 py-4 text-soft text-sm">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent-soft text-blue-600 rounded-full font-bold text-[11px] uppercase tracking-wider">{shift.area}</span>
                    </td>
                    <td className="px-6 py-4 text-right pr-10">
                      <div className="flex gap-2 justify-end">
                        <button 
                          onClick={() => handleOpenEdit(shift)} 
                          className="p-2 hover:bg-accent-soft rounded text-soft hover:text-blue-600 transition-colors"
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => handleDelete(shift.id)} 
                          className="p-2 hover:bg-[var(--danger-soft)] rounded text-soft hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal form */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg bg-surface rounded-lg shadow-2xl p-8 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-[var(--border)]">
                <h3 className="text-xl font-bold text-ink">{editingId ? 'Chỉnh sửa nhân sự' : 'Thêm nhân sự mới'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-subtle rounded-lg transition-colors">
                  <X className="w-6 h-6 text-faint" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-faint uppercase ml-1">Số thứ tự (ID)</label>
                  <input 
                    type="number" 
                    required
                    value={formData.IDnum} 
                    onChange={(e) => setFormData({ ...formData, IDnum: parseInt(e.target.value) || 1 })}
                    className="w-full bg-subtle border border-[var(--border)] px-4 py-3 rounded focus:outline-none focus:ring-2 focus:ring-accent focus:bg-surface transition-all text-sm font-bold font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-faint uppercase ml-1">Họ & Tên</label>
                  <input 
                    type="text" 
                    placeholder="Nguyễn Văn A" 
                    required
                    value={formData.Name} 
                    onChange={(e) => setFormData({ ...formData, Name: e.target.value })}
                    className="w-full bg-subtle border border-[var(--border)] px-4 py-3 rounded focus:outline-none focus:ring-2 focus:ring-accent focus:bg-surface transition-all text-sm font-bold"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-faint uppercase ml-1">Khu vực phân bổ</label>
                  <Select
                    value={formData.area}
                    onChange={(v) => setFormData({ ...formData, area: v })}
                    options={effectiveAreas.map(area => ({ value: area, label: area }))}
                  />
                </div>

                <div className="flex gap-3 justify-end pt-4 border-t border-[var(--border)]">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className="vl-btn vl-btn-secondary"
                  >
                    Hủy
                  </button>
                  <button 
                    type="submit" 
                    className="vl-btn vl-btn-primary flex items-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Lưu lại
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
