import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS } from '../lib/pocketbase';
import { ElectricShift } from '../types';
import { Plus, Trash2, User, Hash, MapPin, RefreshCw, Edit2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function ElectricShiftManager() {
  const [staff, setStaff] = useState<ElectricShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<ElectricShift | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const userArea = pb.authStore.model?.area || '';

  const [formData, setFormData] = useState({
    IDnum: 0,
    Name: '',
    area: userArea || AREAS[0]
  });

  // ====================== LOAD DANH SÁCH (sắp xếp theo IDnum tăng dần) ======================
  const loadStaff = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoading(true);
    try {
      const filter = userArea ? `area = '${userArea.replace(/'/g, "\\'")}'` : '';
      const result = await pb.collection('Electric_shift').getFullList<ElectricShift>({
        filter,
        sort: '+IDnum',           // ← Sắp xếp theo STT tăng dần
        requestKey: null
      });
      setStaff(result);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('Error loading staff:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userArea]);

  useEffect(() => {
    loadStaff();
    const unsubscribe = pb.collection('Electric_shift').subscribe('*', () => loadStaff());
    return () => unsubscribe();
  }, [loadStaff]);

  // ====================== KIỂM TRA IDnum KHÔNG TRÙNG ======================
  const checkDuplicateID = async (idnum: number, area: string, excludeId: string | null = null): Promise<boolean> => {
    try {
      let filter = `IDnum = ${idnum} && area = '${area.replace(/'/g, "\\'")}'`;
      if (excludeId) filter += ` && id != '${excludeId}'`;

      const existing = await pb.collection('Electric_shift').getFullList({
        filter,
        requestKey: null
      });
      return existing.length > 0;
    } catch (err) {
      console.error('Check duplicate error:', err);
      return false;
    }
  };

  // ====================== XÓA NHÂN VIÊN ======================
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Bạn chắc chắn muốn xóa nhân viên "${name}"?`)) return;

    try {
      await pb.collection('Electric_shift').delete(id);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage('Lỗi khi xóa: ' + (err.message || 'Kiểm tra kết nối'));
    }
  };

  // ====================== LƯU (THÊM / SỬA) ======================
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.Name || formData.IDnum <= 0) {
      setErrorMessage('Vui lòng nhập đầy đủ Họ tên và STT (> 0)!');
      return;
    }

    // Kiểm tra IDnum trùng
    const isDuplicate = await checkDuplicateID(
      formData.IDnum,
      formData.area,
      editingStaff?.id || null
    );

    if (isDuplicate) {
      setErrorMessage(`STT ${formData.IDnum} đã tồn tại trong khu vực ${formData.area}. Vui lòng chọn STT khác!`);
      return;
    }

    try {
      if (editingStaff) {
        await pb.collection('Electric_shift').update(editingStaff.id, formData);
      } else {
        await pb.collection('Electric_shift').create(formData);
      }
      setIsModalOpen(false);
      setEditingStaff(null);
      setFormData({ IDnum: 0, Name: '', area: userArea || AREAS[0] });
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage('Lỗi: ' + (err.message || 'Kiểm tra kết nối'));
    }
  };

  const openEdit = (s: ElectricShift) => {
    setEditingStaff(s);
    setFormData({
      IDnum: s.IDnum,
      Name: s.Name,
      area: s.area
    });
    setIsModalOpen(true);
  };

  const openAddNew = () => {
    setEditingStaff(null);
    setFormData({ IDnum: 0, Name: '', area: userArea || AREAS[0] });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Quản lý nhân sự trực</h2>
          <p className="text-slate-500 text-sm">Khu vực: <span className="font-bold text-emerald-600">{userArea || 'Tất cả'}</span></p>
        </div>
        <button 
          onClick={openAddNew}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl font-medium flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Thêm nhân viên
        </button>
      </div>

      {errorMessage && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-red-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Phần bảng danh sách (đã sort theo IDnum) */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <RefreshCw className="w-10 h-10 animate-spin mb-4" />
          <p>Đang tải danh sách...</p>
        </div>
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-[2rem] p-20 text-center text-slate-400 border border-dashed border-slate-200">
          <User className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p>Chưa có nhân viên nào trong danh sách</p>
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest w-20">STT</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Họ và tên</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Khu vực</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {staff.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="bg-emerald-50 text-emerald-700 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm">
                        {s.IDnum}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-700">{s.Name}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-slate-500 text-sm">
                        <MapPin className="w-4 h-4 text-slate-300" />
                        {s.area}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => openEdit(s)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                          title="Sửa"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(s.id, s.Name)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          title="Xóa"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL FORM */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden"
            >
              <div className="px-8 pt-8 pb-6">
                <h3 className="text-2xl font-bold text-slate-800 mb-1">
                  {editingStaff ? 'Sửa thông tin nhân viên' : 'Thêm nhân viên mới'}
                </h3>
                <p className="text-slate-500 text-sm">Khu vực: {userArea || 'Tất cả'}</p>
              </div>

              <form onSubmit={handleSave} className="px-8 space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-2">STT (số thứ tự)</label>
                  <div className="relative">
                    <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="number"
                      value={formData.IDnum}
                      onChange={(e) => setFormData({ ...formData, IDnum: Number(e.target.value) })}
                      className="w-full pl-11 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-emerald-500 text-lg font-medium"
                      placeholder="Nhập STT"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-2">Họ và tên</label>
                  <input
                    type="text"
                    value={formData.Name}
                    onChange={(e) => setFormData({ ...formData, Name: e.target.value })}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-emerald-500 text-lg"
                    placeholder="Nhập họ tên"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-2">Khu vực</label>
                  <select
                    value={formData.area}
                    onChange={(e) => setFormData({ ...formData, area: e.target.value })}
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:border-emerald-500"
                    disabled={!!userArea}
                  >
                    {AREAS.map(area => (
                      <option key={area} value={area}>{area}</option>
                    ))}
                  </select>
                </div>

                {errorMessage && <p className="text-red-500 text-sm">{errorMessage}</p>}

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      setEditingStaff(null);
                      setErrorMessage(null);
                    }}
                    className="flex-1 py-4 text-slate-500 font-medium rounded-2xl hover:bg-slate-100 transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-medium transition-all active:scale-95"
                  >
                    {editingStaff ? 'Lưu thay đổi' : 'Thêm nhân viên'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
