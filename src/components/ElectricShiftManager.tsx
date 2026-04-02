import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, ID_TO_AREA } from '../lib/pocketbase';
import { ElectricShift } from '../types';
import { Plus, Trash2, User, Hash, MapPin, RefreshCw, Edit2, X, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function ElectricShiftManager() {
  const [staff, setStaff] = useState<ElectricShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterArea, setFilterArea] = useState('');
  
  // Inline Editing States
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [tempStaffData, setTempStaffData] = useState({ IDnum: 0, Name: '', area: '' });

  // User areas handling - stabilize with JSON stringification for dependency tracking
  // Supports both singular 'area' (string/array) and plural 'areas' (relation array)
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.areas || pb.authStore.model?.area;
    const items = Array.isArray(raw) 
      ? raw 
      : (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
    // Map IDs to Names if applicable
    return items.map(item => ID_TO_AREA[item] || item);
  }, [JSON.stringify(pb.authStore.model?.areas), JSON.stringify(pb.authStore.model?.area)]);
  
  const effectiveAreas = React.useMemo(() => userAreas.length > 0 ? userAreas : AREAS, [userAreas]);

  const loadStaff = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoading(true);
    try {
      const filterParts: string[] = [];
      
      // Filter theo khu vực của user
      if (filterArea) {
        filterParts.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        const areaFilters = userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ');
        filterParts.push(`(${areaFilters})`);
      }

      const result = await pb.collection('Electric_shift').getFullList<ElectricShift>({
        filter: filterParts.join(' && '),
        sort: 'area,IDnum',
        requestKey: null
      });
      setStaff(result);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('FULL ERROR STAFF:', err);
      setErrorMessage(`Lỗi tải nhân viên (Status: ${err.status}): ` + (err.data?.message || err.message));
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, userAreas]);

  useEffect(() => {
    if (!pb.authStore.isValid) return;
    loadStaff();

    pb.collection('Electric_shift').subscribe('*', () => loadStaff());

    return () => {
      pb.collection('Electric_shift').unsubscribe('*');
    };
  }, [loadStaff]);

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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Bạn chắc chắn muốn xóa nhân viên "${name}"?`)) return;

    try {
      await pb.collection('Electric_shift').delete(id);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage('Lỗi khi xóa: ' + (err.message || 'Kiểm tra kết nối'));
    }
  };

  const startAddStaff = () => {
    setIsAddingStaff(true);
    setEditingStaffId(null);
    setTempStaffData({ IDnum: staff.length + 1, Name: '', area: effectiveAreas[0] || AREAS[0] });
  };

  const startEditStaff = (s: ElectricShift) => {
    setEditingStaffId(s.id);
    setIsAddingStaff(false);
    setTempStaffData({ IDnum: s.IDnum, Name: s.Name, area: s.area });
  };

  const cancelEdit = () => {
    setIsAddingStaff(false);
    setEditingStaffId(null);
    setErrorMessage(null);
  };

  const saveStaff = async (id?: string) => {
    if (!tempStaffData.Name || tempStaffData.IDnum <= 0) {
      setErrorMessage('Vui lòng nhập đầy đủ Họ tên và STT (> 0)!');
      return;
    }

    const isDuplicate = await checkDuplicateID(
      tempStaffData.IDnum,
      tempStaffData.area,
      id || null
    );

    if (isDuplicate) {
      setErrorMessage(`STT ${tempStaffData.IDnum} đã tồn tại trong khu vực ${tempStaffData.area}. Vui lòng chọn STT khác!`);
      return;
    }

    try {
      if (id) {
        await pb.collection('Electric_shift').update(id, tempStaffData);
      } else {
        await pb.collection('Electric_shift').create(tempStaffData);
      }
      cancelEdit();
      loadStaff();
    } catch (err: any) {
      setErrorMessage('Lỗi: ' + (err.message || 'Kiểm tra kết nối'));
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Quản lý nhân sự trực</h2>
          <div className="flex items-center gap-2 text-slate-500 text-sm mt-1">
            <MapPin className="w-4 h-4" />
            <span>Khu vực: </span>
            <span className="font-bold text-emerald-600">
              {filterArea || (userAreas.length === 1 ? userAreas[0] : 'Tất cả khu vực đang quản lý')}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {userAreas.length > 1 || userAreas.length === 0 ? (
            <select 
              value={filterArea} 
              onChange={(e) => setFilterArea(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            >
              <option value="">Tất cả khu vực</option>
              {effectiveAreas.map(area => (
                <option key={area} value={area}>{area}</option>
              ))}
            </select>
          ) : null}
          <button 
            onClick={startAddStaff}
            className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3 rounded-2xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Thêm nhân sự trực
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-red-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="space-y-4">
        {/* Add Staff Inline Row */}
        <AnimatePresence>
          {isAddingStaff && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-emerald-50 border-2 border-emerald-200 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-4 shadow-lg"
            >
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[80px_2fr_1fr] gap-4 w-full">
                <input 
                  type="number" 
                  placeholder="STT"
                  value={tempStaffData.IDnum}
                  onChange={(e) => setTempStaffData({ ...tempStaffData, IDnum: Number(e.target.value) })}
                  className="p-3 bg-white border border-emerald-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 font-bold"
                />
                <input 
                  type="text" 
                  placeholder="Họ và tên"
                  value={tempStaffData.Name}
                  onChange={(e) => setTempStaffData({ ...tempStaffData, Name: e.target.value })}
                  className="p-3 bg-white border border-emerald-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <select 
                  value={tempStaffData.area}
                  onChange={(e) => setTempStaffData({ ...tempStaffData, area: e.target.value })}
                  className="p-3 bg-white border border-emerald-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                  disabled={userAreas.length === 1}
                >
                  {effectiveAreas.map(area => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => saveStaff()} className="p-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"><CheckCircle2 className="w-6 h-6" /></button>
                <button onClick={cancelEdit} className="p-3 bg-slate-200 text-slate-600 rounded-xl hover:bg-slate-300 transition-colors"><X className="w-6 h-6" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-10 h-10 animate-spin mb-4" />
            <p>Đang tải danh sách...</p>
          </div>
        ) : staff.length === 0 && !isAddingStaff ? (
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
                    <tr key={s.id} className={`hover:bg-slate-50/50 transition-colors group ${editingStaffId === s.id ? 'bg-blue-50/30' : ''}`}>
                      <td className="px-6 py-4">
                        {editingStaffId === s.id ? (
                          <input 
                            type="number" 
                            value={tempStaffData.IDnum}
                            onChange={(e) => setTempStaffData({ ...tempStaffData, IDnum: Number(e.target.value) })}
                            className="w-16 p-1.5 bg-white border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                          />
                        ) : (
                          <div className="bg-emerald-50 text-emerald-700 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm">
                            {s.IDnum}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingStaffId === s.id ? (
                          <input 
                            type="text" 
                            value={tempStaffData.Name}
                            onChange={(e) => setTempStaffData({ ...tempStaffData, Name: e.target.value })}
                            className="w-full p-1.5 bg-white border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                        ) : (
                          <span className="font-bold text-slate-700">{s.Name}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {editingStaffId === s.id ? (
                          <select 
                            value={tempStaffData.area}
                            onChange={(e) => setTempStaffData({ ...tempStaffData, area: e.target.value })}
                            className="w-full p-1.5 bg-white border border-blue-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            disabled={userAreas.length === 1}
                          >
                            {effectiveAreas.map(area => (
                              <option key={area} value={area}>{area}</option>
                            ))}
                          </select>
                        ) : (
                          <div className="flex items-center gap-2 text-slate-500 text-sm">
                            <MapPin className="w-4 h-4 text-slate-300" />
                            {s.area}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          {editingStaffId === s.id ? (
                            <>
                              <button onClick={() => saveStaff(s.id)} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"><CheckCircle2 className="w-5 h-5" /></button>
                              <button onClick={cancelEdit} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all"><X className="w-5 h-5" /></button>
                            </>
                          ) : (
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => startEditStaff(s)}
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
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
