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

  const loadStaff = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoading(true);
    try {
      // Filter by user's area if available
      const filter = userArea ? `area = '${userArea.replace(/'/g, "\\'")}'` : '';
      const result = await pb.collection('Electric_shift').getFullList<ElectricShift>({
        filter,
        sort: 'IDnum',
        requestKey: null
      });
      setStaff(result);
    } catch (err: any) {
      if (err.isAbort) return; // Ignore auto-cancelled requests
      console.error('Error loading staff:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userArea]);

  useEffect(() => {
    loadStaff();
    pb.collection('Electric_shift').subscribe('*', () => loadStaff());
    return () => {
      pb.collection('Electric_shift').unsubscribe('*');
    };
  }, [loadStaff]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.Name || !formData.IDnum) {
      setErrorMessage('Vui lòng nhập đầy đủ thông tin!');
      return;
    }

    try {
      if (editingStaff) {
        await pb.collection('Electric_shift').update(editingStaff.id, formData);
      } else {
        if (staff.length >= 6) {
          setErrorMessage('Tối đa chỉ được thêm 6 nhân viên!');
          return;
        }
        await pb.collection('Electric_shift').create(formData);
      }
      setIsModalOpen(false);
      setEditingStaff(null);
      setFormData({ IDnum: 0, Name: '', area: userArea || AREAS[0] });
      setErrorMessage(null);
      loadStaff();
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Quản lý nhân sự trực</h2>
          <p className="text-slate-500 text-sm">Khu vực: <span className="font-bold text-emerald-600">{userArea || 'Tất cả'}</span></p>
        </div>
        <button 
          onClick={() => { 
            if (staff.length >= 6) {
              setErrorMessage('Tối đa chỉ được thêm 6 nhân viên!');
              return;
            }
            setEditingStaff(null); 
            setFormData({ IDnum: staff.length + 1, Name: '', area: userArea || AREAS[0] }); 
            setIsModalOpen(true); 
          }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl font-medium flex items-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={staff.length >= 6}
        >
          <Plus className="w-5 h-5" />
          Thêm nhân viên ({staff.length}/6)
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <form onSubmit={handleSave} className="p-8">
                <h3 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                  <User className="w-7 h-7 text-emerald-600" />
                  {editingStaff ? 'Sửa nhân viên' : 'Thêm nhân viên mới'}
                </h3>

                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Số thứ tự (STT)</label>
                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input 
                        type="number"
                        value={formData.IDnum}
                        readOnly
                        className="w-full pl-12 pr-4 py-4 bg-slate-100 border border-slate-200 rounded-2xl text-slate-500 cursor-not-allowed outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Họ và tên</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input 
                        placeholder="Nhập họ tên nhân viên"
                        value={formData.Name}
                        onChange={(e) => setFormData({ ...formData, Name: e.target.value })}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-8">
                  <button 
                    type="button" onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-4 rounded-2xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    type="submit"
                    className="flex-[2] bg-emerald-600 hover:bg-emerald-700 text-white py-4 rounded-2xl font-bold shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
                  >
                    {editingStaff ? 'Cập nhật' : 'Lưu nhân viên'}
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
