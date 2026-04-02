import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS } from '../lib/pocketbase';
import { Customer, Meter, AccountHes, HesItem } from '../types';
import { 
  Plus, Trash2, User, Hash, MapPin, RefreshCw, Edit2, X, 
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Search,
  CreditCard, Gauge, Users, CloudDownload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function CustomerManager() {
  const [activeTab, setActiveTab] = useState<'customers' | 'meters'>('customers');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [meters, setMeters] = useState<Record<string, Meter[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [filterArea, setFilterArea] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Inline Editing States
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [tempCustomerData, setTempCustomerData] = useState({ Name: '', MKH: '', area: '' });

  const [editingMeterId, setEditingMeterId] = useState<string | null>(null);
  const [isAddingMeter, setIsAddingMeter] = useState(false);
  const [tempMeterData, setTempMeterData] = useState({ MeterNo: '', HSN: '', Type: '', CreatedHES: '', Line: '', Customer: '', area: '', Activate: true });

  // HES Sync States
  const [hesAccount, setHesAccount] = useState<AccountHes | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isGettingToken, setIsGettingToken] = useState(false);
  const [hesPreviewData, setHesPreviewData] = useState<HesItem[]>([]);
  const [selectedHesIds, setSelectedHesIds] = useState<string[]>([]);
  const [showHesPreview, setShowHesPreview] = useState(false);
  const [isSavingHes, setIsSavingHes] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ current: 0, total: 0 });

  // Batch Meter Status Changes
  const [pendingMeterChanges, setPendingMeterChanges] = useState<Record<string, boolean>>({});
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);

  // User areas handling - stabilize with JSON stringification for dependency tracking
  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    const areas = Array.isArray(raw) 
      ? raw 
      : (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
    return areas;
  }, [JSON.stringify(pb.authStore.model?.area)]);
  
  const effectiveAreas = React.useMemo(() => userAreas.length > 0 ? userAreas : AREAS, [userAreas]);

  const loadCustomers = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoading(true);
    try {
      const filterParts: string[] = [];
      if (filterArea) {
        filterParts.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        const areaFilters = userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ');
        filterParts.push(`(${areaFilters})`);
      }
      if (searchTerm) {
        filterParts.push(`(Name ~ '${searchTerm}' || MKH ~ '${searchTerm}')`);
      }

      const result = await pb.collection('Customer').getFullList<Customer>({
        filter: filterParts.join(' && '),
        sort: 'MKH',
        requestKey: null
      });
      setCustomers(result);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('Error loading customers:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, userAreas, searchTerm]);

  const loadHesAccount = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    try {
      // Fetch the first available record. PocketBase rules (area = @request.auth.area) 
      // will ensure the user only gets the record for their area.
      const result = await pb.collection('AccountHes').getFirstListItem('');
      setHesAccount(result);
    } catch (err) {
      console.log('AccountHes not found or access denied');
    }
  }, []);

  const loadMetersForCustomer = async (customerId: string) => {
    try {
      const result = await pb.collection('Meter').getFullList<Meter>({
        filter: `Customer = '${customerId}'`,
        sort: 'MeterNo',
        requestKey: null
      });
      setMeters(prev => ({ ...prev, [customerId]: result }));
    } catch (err) {
      console.error('Error loading meters:', err);
    }
  };

  const loadAllMeters = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoading(true);
    try {
      const filterParts: string[] = [];
      if (filterArea) {
        filterParts.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        const areaFilters = userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ');
        filterParts.push(`(${areaFilters})`);
      }
      if (searchTerm) {
        filterParts.push(`(MeterNo ~ '${searchTerm}' || Customer.Name ~ '${searchTerm}' || Customer.MKH ~ '${searchTerm}')`);
      }

      const result = await pb.collection('Meter').getFullList<Meter>({
        filter: filterParts.join(' && '),
        sort: 'Customer.MKH',
        expand: 'Customer',
        requestKey: null
      });
      setAllMeters(result);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('Error loading all meters:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filterArea, userAreas, searchTerm]);

  useEffect(() => {
    if (activeTab === 'customers') {
      loadCustomers();
    } else {
      loadAllMeters();
    }
    loadHesAccount();
  }, [activeTab, loadCustomers, loadAllMeters, loadHesAccount]);

  // Customer Handlers
  const startAddCustomer = () => {
    setIsAddingCustomer(true);
    setEditingCustomerId(null);
    setTempCustomerData({ Name: '', MKH: '', area: effectiveAreas[0] || AREAS[0] });
  };

  const startEditCustomer = (c: Customer) => {
    setEditingCustomerId(c.id);
    setIsAddingCustomer(false);
    setTempCustomerData({ Name: c.Name, MKH: c.MKH, area: c.area });
  };

  const cancelCustomerEdit = () => {
    setIsAddingCustomer(false);
    setEditingCustomerId(null);
  };

  const saveCustomer = async (id?: string) => {
    try {
      if (id) {
        await pb.collection('Customer').update(id, tempCustomerData);
      } else {
        await pb.collection('Customer').create(tempCustomerData);
      }
      cancelCustomerEdit();
      loadCustomers();
    } catch (err) {
      console.error('Save customer error:', err);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    try {
      await pb.collection('Customer').delete(id);
      loadCustomers();
    } catch (err) {
      console.error('Delete customer error:', err);
    }
  };

  // Meter Handlers
  const startAddMeter = () => {
    setIsAddingMeter(true);
    setEditingMeterId(null);
    setTempMeterData({ 
      MeterNo: '', 
      HSN: '', 
      Type: '', 
      CreatedHES: '', 
      Line: '', 
      Customer: '', 
      area: effectiveAreas[0] || AREAS[0], 
      Activate: true 
    });
  };

  const startEditMeter = (m: Meter) => {
    setEditingMeterId(m.id);
    setIsAddingMeter(false);
    setTempMeterData({ 
      MeterNo: m.MeterNo, 
      HSN: m.HSN || '', 
      Type: m.Type || '', 
      CreatedHES: m.CreatedHES || '', 
      Line: m.Line || '', 
      Customer: m.Customer, 
      area: m.area, 
      Activate: m.Activate 
    });
  };

  const cancelMeterEdit = () => {
    setIsAddingMeter(false);
    setEditingMeterId(null);
  };

  const saveMeter = async (meterId?: string) => {
    try {
      if (meterId) {
        await pb.collection('Meter').update(meterId, tempMeterData);
      } else {
        await pb.collection('Meter').create(tempMeterData);
      }
      cancelMeterEdit();
      loadAllMeters();
    } catch (err) {
      console.error('Save meter error:', err);
    }
  };

  const toggleMeterActivate = (meter: Meter) => {
    setPendingMeterChanges(prev => {
      const next = { ...prev };
      const currentVal = next[meter.id] !== undefined ? next[meter.id] : meter.Activate;
      const newVal = !currentVal;
      
      if (newVal === meter.Activate) {
        delete next[meter.id];
      } else {
        next[meter.id] = newVal;
      }
      return next;
    });
  };

  const handleBatchUpdate = async () => {
    const ids = Object.keys(pendingMeterChanges);
    if (ids.length === 0) return;

    setIsBatchUpdating(true);
    try {
      await Promise.all(ids.map(id => 
        pb.collection('Meter').update(id, { Activate: pendingMeterChanges[id] })
      ));
      setPendingMeterChanges({});
      await loadAllMeters();
    } catch (err) {
      console.error('Batch update error:', err);
      alert('Lỗi khi cập nhật trạng thái hàng loạt');
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleDeleteMeter = async (meterId: string) => {
    try {
      await pb.collection('Meter').delete(meterId);
      if (activeTab === 'meters') {
        loadAllMeters();
      }
    } catch (err) {
      console.error('Delete meter error:', err);
    }
  };

  // HES Handlers
  const getToken = async () => {
    if (!hesAccount) {
      alert('Không tìm thấy thông tin tài khoản HES.');
      return;
    }

    setIsGettingToken(true);
    try {
      const url = `/hes/api/Login?UserAccount=${hesAccount.Account}&Password=${hesAccount.Password}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Lỗi kết nối API lấy Token');
      
      const data = await res.json();
      if (data && data.TOKEN) {
        const updated = await pb.collection('AccountHes').update(hesAccount.id, { Token: data.TOKEN });
        setHesAccount(updated as any);
        alert('Lấy Token thành công!');
      } else {
        throw new Error('Không nhận được Token từ phản hồi');
      }
    } catch (err: any) {
      console.error('Get Token error:', err);
      alert('Lỗi lấy Token: ' + err.message);
    } finally {
      setIsGettingToken(false);
    }
  };

  const syncFromHes = async () => {
    if (!hesAccount) {
      alert('Không tìm thấy thông tin tài khoản HES trong hệ thống. Vui lòng kiểm tra collection AccountHes.');
      return;
    }

    setIsSyncing(true);
    try {
      const url = `/hes/api/GetMeterAccount?UserID=${hesAccount.HesID}&Token=${hesAccount.Token || 'Token'}`;
      const dataRes = await fetch(url);
      
      if (!dataRes.ok) throw new Error(`Lỗi kết nối HES API: ${dataRes.status}`);
      const hesData: any = await dataRes.json();

      // Check for invalid token error
      if (hesData && hesData.CODE === "0" && hesData.MESSAGE === "invalid token") {
        alert('Token đã hết hạn hoặc không hợp lệ. Vui lòng nhấn "Lấy Token" và thử lại.');
        setIsSyncing(false);
        return;
      }

      if (!Array.isArray(hesData)) {
        throw new Error('Dữ liệu từ HES không đúng định dạng danh sách');
      }

      const hesItems: HesItem[] = hesData;
      // Filter by ADDRESS matching hesAccount.area
      const filteredData = hesItems.filter(item => item.ADDRESS === hesAccount.area);
      
      if (filteredData.length === 0) {
        alert(`Không tìm thấy bản ghi nào có địa chỉ trùng với khu vực "${hesAccount.area}"`);
        return;
      }

      // Check for duplicates in PocketBase
      const existingMeters = await pb.collection('Meter').getFullList({
        fields: 'MeterNo',
        filter: `area = "${hesAccount.area}"`
      });
      const existingMeterNos = new Set(existingMeters.map(m => m.MeterNo));

      const previewWithDupCheck = filteredData.map(item => ({
        ...item,
        isDuplicate: existingMeterNos.has(item.METER_NO)
      }));

      setHesPreviewData(previewWithDupCheck);
      setSelectedHesIds(previewWithDupCheck.filter(item => !item.isDuplicate).map(item => item.METER_NO));
      setShowHesPreview(true);
    } catch (err: any) {
      console.error('HES Sync error:', err);
      alert('Lỗi đồng bộ HES: ' + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const saveSelectedHesData = async () => {
    if (selectedHesIds.length === 0) {
      alert('Vui lòng chọn ít nhất một bản ghi để lưu.');
      return;
    }

    const itemsToSave = hesPreviewData.filter(item => selectedHesIds.includes(item.METER_NO));
    setIsSavingHes(true);
    setSaveProgress({ current: 0, total: itemsToSave.length });

    try {
      let successCount = 0;
      for (let i = 0; i < itemsToSave.length; i++) {
        const item = itemsToSave[i];
        setSaveProgress({ current: i + 1, total: itemsToSave.length });
        
        try {
          // Find or Create Customer
          let customer: Customer;
          try {
            customer = await pb.collection('Customer').getFirstListItem(`MKH = '${item.CUSTOMER_CODE}'`);
          } catch (err) {
            customer = await pb.collection('Customer').create({
              Name: item.CUSTOMER_NAME,
              MKH: item.CUSTOMER_CODE,
              area: hesAccount?.area || effectiveAreas[0]
            });
          }

          // Find or Create Meter
          try {
            await pb.collection('Meter').getFirstListItem(`MeterNo = '${item.METER_NO}'`);
          } catch (err) {
            await pb.collection('Meter').create({
              MeterNo: item.METER_NO,
              HSN: item.METER_NAME,
              Type: item.METER_MODEL_DESC,
              CreatedHES: item.CREATED,
              Line: item.LINE_NAME,
              Customer: customer.id,
              area: hesAccount?.area || effectiveAreas[0],
              Activate: true
            });
          }
          successCount++;
        } catch (err) {
          console.error(`Lỗi khi lưu công tơ ${item.METER_NO}:`, err);
        }
      }

      alert(`Đã lưu thành công ${successCount} bản ghi.`);
      setShowHesPreview(false);
      if (activeTab === 'customers') {
        loadCustomers();
      } else {
        loadAllMeters();
      }
    } catch (err: any) {
      console.error('Save HES data error:', err);
      alert('Lỗi khi lưu dữ liệu: ' + err.message);
    } finally {
      setIsSavingHes(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Quản lý khách hàng & Công tơ</h2>
          <p className="text-slate-500 text-sm mt-1">Hệ thống quản lý thông tin khách hàng và thiết bị đo đếm</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder={activeTab === 'customers' ? "Tìm tên, mã KH..." : "Tìm số công tơ, tên KH..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
            />
          </div>
          
          <button 
            onClick={getToken}
            disabled={isGettingToken || isSyncing}
            className="bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white px-4 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-slate-600/20 transition-all active:scale-95"
          >
            {isGettingToken ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            {isGettingToken ? 'Đang lấy...' : 'Lấy Token'}
          </button>

          <button 
            onClick={syncFromHes}
            disabled={isSyncing || isGettingToken}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-95"
          >
            {isSyncing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <CloudDownload className="w-5 h-5" />}
            {isSyncing ? 'Đang đồng bộ...' : 'Lấy dữ liệu HES'}
          </button>

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

          {activeTab === 'customers' ? (
            <button 
              onClick={startAddCustomer}
              className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Thêm khách hàng
            </button>
          ) : (
            <button 
              onClick={startAddMeter}
              className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Thêm công tơ
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        <button 
          onClick={() => setActiveTab('customers')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'customers' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Thông tin khách hàng
          </div>
        </button>
        <button 
          onClick={() => setActiveTab('meters')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${activeTab === 'meters' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4" />
            Thông tin công tơ
          </div>
        </button>
      </div>

      <div className="space-y-4">
        {/* HES Preview Modal */}
        <AnimatePresence>
          {showHesPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-[2rem] w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
              >
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Xem trước dữ liệu HES</h3>
                    <p className="text-sm text-slate-500">Tìm thấy {hesPreviewData.length} bản ghi tại {hesAccount?.area}</p>
                  </div>
                  <button 
                    onClick={() => setShowHesPreview(false)} 
                    disabled={isSavingHes}
                    className="p-2 hover:bg-slate-200 rounded-full transition-colors disabled:opacity-50"
                  >
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-auto p-6">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="border-b border-slate-100">
                        <th className="p-3">
                          <input 
                            type="checkbox" 
                            checked={selectedHesIds.length === hesPreviewData.length}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedHesIds(hesPreviewData.map(item => item.METER_NO));
                              } else {
                                setSelectedHesIds([]);
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                        </th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Mã KH</th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Tên khách hàng</th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Số công tơ</th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Trạm</th>
                        <th className="p-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {hesPreviewData.map((item) => (
                        <tr key={item.METER_NO} className={`hover:bg-slate-50 transition-colors ${item.isDuplicate ? 'opacity-60 bg-amber-50/30' : ''}`}>
                          <td className="p-3">
                            <input 
                              type="checkbox" 
                              checked={selectedHesIds.includes(item.METER_NO)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedHesIds([...selectedHesIds, item.METER_NO]);
                                } else {
                                  setSelectedHesIds(selectedHesIds.filter(id => id !== item.METER_NO));
                                }
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-3 font-mono text-sm text-slate-600">{item.CUSTOMER_CODE}</td>
                          <td className="p-3 text-sm font-medium text-slate-800">{item.CUSTOMER_NAME}</td>
                          <td className="p-3 font-mono text-sm text-blue-600">{item.METER_NO}</td>
                          <td className="p-3 text-sm text-slate-500">{item.LINE_NAME}</td>
                          <td className="p-3">
                            {item.isDuplicate ? (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">
                                <RefreshCw className="w-3 h-3" /> Đã tồn tại
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">
                                <CheckCircle2 className="w-3 h-3" /> Mới
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <div className="text-sm text-slate-500">
                    Đã chọn <span className="font-bold text-slate-800">{selectedHesIds.length}</span> / {hesPreviewData.length} bản ghi
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setShowHesPreview(false)}
                      disabled={isSavingHes}
                      className="px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
                    >
                      Hủy bỏ
                    </button>
                    <button 
                      onClick={saveSelectedHesData}
                      disabled={isSavingHes || selectedHesIds.length === 0}
                      className="px-8 py-2.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-600/20 transition-all active:scale-95 disabled:bg-blue-300 flex items-center gap-2"
                    >
                      {isSavingHes ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin" />
                          Đang lưu ({saveProgress.current}/{saveProgress.total})
                        </>
                      ) : (
                        <>
                          <CloudDownload className="w-5 h-5" />
                          Lưu vào hệ thống
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Add Customer Row */}
        <AnimatePresence>
          {isAddingCustomer && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-emerald-50 border-2 border-emerald-200 rounded-3xl p-6 flex flex-col sm:flex-row items-center gap-4 shadow-lg"
            >
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-4 w-full">
                <input 
                  type="text" 
                  placeholder="Tên khách hàng"
                  value={tempCustomerData.Name}
                  onChange={(e) => setTempCustomerData({ ...tempCustomerData, Name: e.target.value })}
                  className="p-3 bg-white border border-emerald-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <input 
                  type="text" 
                  placeholder="Mã khách hàng"
                  value={tempCustomerData.MKH}
                  onChange={(e) => setTempCustomerData({ ...tempCustomerData, MKH: e.target.value })}
                  className="p-3 bg-white border border-emerald-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <select 
                  value={tempCustomerData.area}
                  onChange={(e) => setTempCustomerData({ ...tempCustomerData, area: e.target.value })}
                  className="p-3 bg-white border border-emerald-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {effectiveAreas.map(area => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => saveCustomer()} className="p-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"><CheckCircle2 className="w-6 h-6" /></button>
                <button onClick={cancelCustomerEdit} className="p-3 bg-slate-200 text-slate-600 rounded-xl hover:bg-slate-300 transition-colors"><X className="w-6 h-6" /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add Meter Row */}
        <AnimatePresence>
          {isAddingMeter && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-blue-50 border-2 border-blue-200 rounded-3xl p-6 flex flex-col gap-4 shadow-lg"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <input 
                  type="text" 
                  placeholder="Số công tơ"
                  value={tempMeterData.MeterNo}
                  onChange={(e) => setTempMeterData({ ...tempMeterData, MeterNo: e.target.value })}
                  className="p-3 bg-white border border-blue-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input 
                  type="text" 
                  placeholder="HSN"
                  value={tempMeterData.HSN}
                  onChange={(e) => setTempMeterData({ ...tempMeterData, HSN: e.target.value })}
                  className="p-3 bg-white border border-blue-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input 
                  type="text" 
                  placeholder="Loại công tơ"
                  value={tempMeterData.Type}
                  onChange={(e) => setTempMeterData({ ...tempMeterData, Type: e.target.value })}
                  className="p-3 bg-white border border-blue-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                />
                <select 
                  value={tempMeterData.Customer}
                  onChange={(e) => setTempMeterData({ ...tempMeterData, Customer: e.target.value })}
                  className="p-3 bg-white border border-blue-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Chọn khách hàng</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.Name} ({c.MKH})</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <select 
                    value={tempMeterData.area}
                    onChange={(e) => setTempMeterData({ ...tempMeterData, area: e.target.value })}
                    className="p-3 bg-white border border-blue-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {effectiveAreas.map(area => (
                      <option key={area} value={area}>{area}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button 
                      type="button"
                      onClick={() => setTempMeterData({ ...tempMeterData, Activate: !tempMeterData.Activate })}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${tempMeterData.Activate ? 'bg-emerald-500' : 'bg-slate-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${tempMeterData.Activate ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className="text-sm font-medium text-slate-600">Hoạt động</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => saveMeter()} className="px-6 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-bold">Lưu</button>
                  <button onClick={cancelMeterEdit} className="px-6 py-2 bg-slate-200 text-slate-600 rounded-xl hover:bg-slate-300 transition-colors font-bold">Hủy</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-10 h-10 animate-spin mb-4" />
            <p>Đang tải dữ liệu...</p>
          </div>
        ) : activeTab === 'customers' ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" />
                Danh sách khách hàng
              </h3>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Mã khách hàng</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Tên khách hàng</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Khu vực</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-20 text-center text-slate-400">
                      <Users className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>Chưa có khách hàng nào</p>
                    </td>
                  </tr>
                ) : (
                  customers.map((customer) => (
                    <tr key={customer.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="p-4">
                        {editingCustomerId === customer.id ? (
                          <input 
                            type="text" 
                            value={tempCustomerData.MKH}
                            onChange={(e) => setTempCustomerData({ ...tempCustomerData, MKH: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                          />
                        ) : (
                          <span className="font-mono text-sm font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">{customer.MKH}</span>
                        )}
                      </td>
                      <td className="p-4">
                        {editingCustomerId === customer.id ? (
                          <input 
                            type="text" 
                            value={tempCustomerData.Name}
                            onChange={(e) => setTempCustomerData({ ...tempCustomerData, Name: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                          />
                        ) : (
                          <span className="font-bold text-slate-800">{customer.Name}</span>
                        )}
                      </td>
                      <td className="p-4">
                        {editingCustomerId === customer.id ? (
                          <select 
                            value={tempCustomerData.area}
                            onChange={(e) => setTempCustomerData({ ...tempCustomerData, area: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                          >
                            {effectiveAreas.map(area => (
                              <option key={area} value={area}>{area}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" /> {customer.area}</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {editingCustomerId === customer.id ? (
                            <>
                              <button onClick={() => saveCustomer(customer.id)} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"><CheckCircle2 className="w-5 h-5" /></button>
                              <button onClick={cancelCustomerEdit} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all"><X className="w-5 h-5" /></button>
                            </>
                          ) : (
                            <>
                              <button 
                                onClick={() => startEditCustomer(customer)}
                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteCustomer(customer.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Gauge className="w-5 h-5 text-blue-600" />
                Danh sách công tơ
              </h3>
              {Object.keys(pendingMeterChanges).length > 0 && (
                <button 
                  onClick={handleBatchUpdate}
                  disabled={isBatchUpdating}
                  className="bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-amber-500/20 transition-all active:scale-95"
                >
                  {isBatchUpdating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Cập nhật ({Object.keys(pendingMeterChanges).length})
                </button>
              )}
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Số công tơ</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Khách hàng</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Loại / HSN</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Trạm / Khu vực</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Trạng thái</th>
                  <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {allMeters.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-20 text-center text-slate-400">
                      <Gauge className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>Chưa có công tơ nào</p>
                    </td>
                  </tr>
                ) : (
                  allMeters.map((meter) => (
                    <tr key={meter.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="p-4">
                        {editingMeterId === meter.id ? (
                          <input 
                            type="text" 
                            value={tempMeterData.MeterNo}
                            onChange={(e) => setTempMeterData({ ...tempMeterData, MeterNo: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          />
                        ) : (
                          <span className="font-mono text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">{meter.MeterNo}</span>
                        )}
                      </td>
                      <td className="p-4">
                        {editingMeterId === meter.id ? (
                          <select 
                            value={tempMeterData.Customer}
                            onChange={(e) => setTempMeterData({ ...tempMeterData, Customer: e.target.value })}
                            className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                          >
                            <option value="">Chọn khách hàng</option>
                            {customers.map(c => (
                              <option key={c.id} value={c.id}>{c.Name}</option>
                            ))}
                          </select>
                        ) : (
                          <div>
                            <div className="font-bold text-slate-800">{meter.expand?.Customer?.Name || 'N/A'}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{meter.expand?.Customer?.MKH}</div>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        {editingMeterId === meter.id ? (
                          <div className="flex flex-col gap-1">
                            <input 
                              type="text" 
                              placeholder="Loại"
                              value={tempMeterData.Type}
                              onChange={(e) => setTempMeterData({ ...tempMeterData, Type: e.target.value })}
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                            <input 
                              type="text" 
                              placeholder="HSN"
                              value={tempMeterData.HSN}
                              onChange={(e) => setTempMeterData({ ...tempMeterData, HSN: e.target.value })}
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="text-sm text-slate-600">{meter.Type}</div>
                            <div className="text-xs text-slate-400">HSN: {meter.HSN}</div>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        {editingMeterId === meter.id ? (
                          <div className="flex flex-col gap-1">
                            <input 
                              type="text" 
                              placeholder="Trạm"
                              value={tempMeterData.Line}
                              onChange={(e) => setTempMeterData({ ...tempMeterData, Line: e.target.value })}
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                            <select 
                              value={tempMeterData.area}
                              onChange={(e) => setTempMeterData({ ...tempMeterData, area: e.target.value })}
                              className="w-full p-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            >
                              {effectiveAreas.map(area => (
                                <option key={area} value={area}>{area}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div>
                            <div className="text-sm text-slate-600">{meter.Line}</div>
                            <div className="text-xs text-slate-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> {meter.area}</div>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        {(() => {
                          const isActivated = pendingMeterChanges[meter.id] !== undefined 
                            ? pendingMeterChanges[meter.id] 
                            : meter.Activate;
                          const isPending = pendingMeterChanges[meter.id] !== undefined;

                          return (
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={() => toggleMeterActivate(meter)}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isActivated ? 'bg-emerald-500' : 'bg-slate-300'}`}
                              >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActivated ? 'translate-x-6' : 'translate-x-1'}`} />
                              </button>
                              {isPending && (
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" title="Thay đổi chưa lưu" />
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {editingMeterId === meter.id ? (
                            <>
                              <button onClick={() => saveMeter(meter.id)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><CheckCircle2 className="w-5 h-5" /></button>
                              <button onClick={cancelMeterEdit} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all"><X className="w-5 h-5" /></button>
                            </>
                          ) : (
                            <>
                              <button 
                                onClick={() => startEditMeter(meter)}
                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteMeter(meter.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
