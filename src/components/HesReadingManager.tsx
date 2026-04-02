import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS, ID_TO_AREA } from '../lib/pocketbase';
import { Meter } from '../types';
import { 
  Search, RefreshCw, Cpu, Calendar, Clock, 
  Database, Zap, ArrowRight, Table as TableIcon,
  LayoutGrid, List, Save, AlertCircle, Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AccountHes } from '../types';
import * as XLSX from 'xlsx';

interface ReadingData {
  meterNo: string;
  pg: string;
  bt: string;
  cd: string;
  td: string;
  vc: string;
  status: 'idle' | 'loading' | 'success' | 'error';
}

interface ReadingSection {
  id: number;
  dateTime: {
    day: string;
    month: string;
    year: string;
    hour: string;
    minute: string;
  };
  readings: Record<string, ReadingData>;
}

export default function HesReadingManager() {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [isLoadingMeters, setIsLoadingMeters] = useState(true);
  const [filterArea, setFilterArea] = useState('');
  const [hesAccount, setHesAccount] = useState<AccountHes | null>(null);
  
  // 2 Identical Reading Sections
  const [sections, setSections] = useState<ReadingSection[]>([
    {
      id: 1,
      dateTime: {
        day: new Date().getDate().toString(),
        month: (new Date().getMonth() + 1).toString(),
        year: new Date().getFullYear().toString(),
        hour: new Date().getHours().toString(),
        minute: '0'
      },
      readings: {}
    },
    {
      id: 2,
      dateTime: {
        day: new Date().getDate().toString(),
        month: (new Date().getMonth() + 1).toString(),
        year: new Date().getFullYear().toString(),
        hour: new Date().getHours().toString(),
        minute: '0'
      },
      readings: {}
    }
  ]);

  const userAreas = React.useMemo(() => {
    const raw = pb.authStore.model?.area;
    const items = Array.isArray(raw) 
      ? raw 
      : (typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []);
    return items.map(item => ID_TO_AREA[item] || item);
  }, [JSON.stringify(pb.authStore.model?.area)]);
  
  const effectiveAreas = React.useMemo(() => userAreas.length > 0 ? userAreas : AREAS, [userAreas]);

  const loadHesAccount = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    try {
      const area = filterArea || userAreas[0] || AREAS[0];
      const result = await pb.collection('AccountHes').getFirstListItem(`area = '${area.replace(/'/g, "\\'")}'`, {
        requestKey: null
      });
      setHesAccount(result as any);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('Error loading HES account:', err);
      setHesAccount(null);
    }
  }, [filterArea, userAreas]);

  const loadMeters = useCallback(async () => {
    if (!pb.authStore.isValid) return;
    setIsLoadingMeters(true);
    try {
      const filterParts: string[] = [];
      
      // Only include active meters
      filterParts.push('Activate = true');
      
      if (filterArea) {
        filterParts.push(`area = '${filterArea.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        const areaFilters = userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ');
        filterParts.push(`(${areaFilters})`);
      }

      const result = await pb.collection('Meter').getFullList<Meter>({
        filter: filterParts.join(' && '),
        sort: 'Line,MeterNo', // Sorted by Line (Trạm) then MeterNo
        requestKey: null
      });
      setMeters(result);
    } catch (err: any) {
      if (err.isAbort) return;
      console.error('Error loading meters:', err);
    } finally {
      setIsLoadingMeters(false);
    }
  }, [filterArea, userAreas]);

  useEffect(() => {
    loadMeters();
    loadHesAccount();
  }, [loadMeters, loadHesAccount]);

  const updateSectionDateTime = (sectionId: number, field: keyof ReadingSection['dateTime'], value: string) => {
    setSections(prev => prev.map(s => 
      s.id === sectionId 
        ? { ...s, dateTime: { ...s.dateTime, [field]: value } } 
        : s
    ));
  };

  const fetchReadingsForSection = async (sectionId: number) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || meters.length === 0) return;

    if (!hesAccount?.Token) {
      alert('Vui lòng lấy Token HES ở phần Thông tin chung trước.');
      return;
    }

    setSections(prev => prev.map(s => {
      if (s.id === sectionId) {
        const initialReadings: Record<string, ReadingData> = {};
        meters.forEach(m => {
          initialReadings[m.MeterNo] = {
            meterNo: m.MeterNo,
            pg: '-',
            bt: '-',
            cd: '-',
            td: '-',
            vc: '-',
            status: 'loading'
          };
        });
        return { ...s, readings: initialReadings };
      }
      return s;
    }));

    const batchSize = 3; // Reduced batch size to be more gentle on the server
    for (let i = 0; i < meters.length; i += batchSize) {
      const batch = meters.slice(i, i + batchSize);
      await Promise.all(batch.map(async (meter) => {
        try {
          const { day, month, year, hour, minute } = section.dateTime;
          let currentMinute = parseInt(minute);
          let currentHour = parseInt(hour);
          let finalResult = null;
          let attempts = 0;
          const maxRetries = 29;

          while (attempts <= maxRetries) {
            // Handle minute/hour overflow
            let displayMinute = currentMinute;
            let displayHour = currentHour;
            
            if (displayMinute >= 60) {
              displayHour += Math.floor(displayMinute / 60);
              displayMinute = displayMinute % 60;
            }
            if (displayHour >= 24) {
              displayHour = displayHour % 24;
            }

            const url = `/hes/api/GELEXPOWER_getInstant?MA_DDO=ABC&MA_CTO=${meter.MeterNo}&GIO=${displayHour}&PHUT=${displayMinute}&NGAY=${day}&THANG=${month}&NAM=${year}&TOKEN=${hesAccount.Token}`;
            
            const response = await fetch(url);
            if (response.ok) {
              const data = await response.json();
              const result = Array.isArray(data) ? data[0] : data;

              if (result?.MESSAGE === 'invalid token') {
                alert('Token HES đã hết hạn. Vui lòng lấy lại Token ở phần Thông tin chung.');
                throw new Error('Invalid token');
              }

              const bieuTong = parseFloat(result?.BIEU_TONG || '0');
              if (bieuTong > 0) {
                finalResult = result;
                break;
              }
            }

            currentMinute++;
            attempts++;
            // Small delay between retries for the same meter
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          if (!finalResult) {
            throw new Error('No data found after retries');
          }
          
          setSections(prev => prev.map(s => {
            if (s.id === sectionId) {
              return {
                ...s,
                readings: {
                  ...s.readings,
                  [meter.MeterNo]: {
                    meterNo: meter.MeterNo,
                    pg: finalResult?.BIEU_TONG || '0',
                    bt: finalResult?.BIEU_1 || '0',
                    cd: finalResult?.BIEU_2 || '0',
                    td: finalResult?.BIEU_3 || '0',
                    vc: finalResult?.BIEU_TONG_VC || '0',
                    status: 'success'
                  }
                }
              };
            }
            return s;
          }));
        } catch (err) {
          console.error(`Error fetching for meter ${meter.MeterNo}:`, err);
          setSections(prev => prev.map(s => {
            if (s.id === sectionId) {
              return {
                ...s,
                readings: {
                  ...s.readings,
                  [meter.MeterNo]: {
                    ...s.readings[meter.MeterNo],
                    status: 'error'
                  }
                }
              };
            }
            return s;
          }));
        }
      }));
      // Delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  const getConsumptionValue = (meterNo: string, field: 'pg' | 'bt' | 'cd' | 'td' | 'vc', hsn: string) => {
    const r1 = sections[0].readings[meterNo];
    const r2 = sections[1].readings[meterNo];
    
    if (r1?.status === 'success' && r2?.status === 'success') {
      const val1 = parseFloat(r1[field]);
      const val2 = parseFloat(r2[field]);
      const factor = parseFloat(hsn) || 1;
      
      if (!isNaN(val1) && !isNaN(val2)) {
        // Round to 3 decimal places as standard, but ensure it's a clean round
        return Math.round((val2 - val1) * factor * 1000) / 1000;
      }
    }
    return null;
  };

  const formatConsumption = (val: number | null) => {
    if (val === null) return '-';
    return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  };

  const exportToExcel = () => {
    if (meters.length === 0) return;

    const data = meters.map(m => ({
      'Số công tơ': m.MeterNo,
      'Trạm (Line)': m.Line || '',
      'HSN': m.HSN || '',
      'Tổng (kWh)': getConsumptionValue(m.MeterNo, 'pg', m.HSN),
      'Biểu 1 (kWh)': getConsumptionValue(m.MeterNo, 'bt', m.HSN),
      'Biểu 2 (kWh)': getConsumptionValue(m.MeterNo, 'cd', m.HSN),
      'Biểu 3 (kWh)': getConsumptionValue(m.MeterNo, 'td', m.HSN),
      'Vô công (kVarh)': getConsumptionValue(m.MeterNo, 'vc', m.HSN),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SanLuong');
    
    const fileName = `SanLuong_HES_${new Date().getTime()}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Parts 1 & 2: Reading Sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {sections.map((section) => (
          <div key={section.id} className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm flex flex-col">
            <div className="p-6 border-b border-slate-100 bg-slate-50/30">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl shadow-lg ${section.id === 1 ? 'bg-blue-600 shadow-blue-600/20' : 'bg-purple-600 shadow-purple-600/20'}`}>
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-800">Lấy chỉ số đợt {section.id}</h3>
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Chỉ số tức thời HES</p>
                  </div>
                </div>
                <button 
                  onClick={() => fetchReadingsForSection(section.id)}
                  disabled={meters.length === 0}
                  className={`px-6 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${
                    section.id === 1 
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20' 
                      : 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20'
                  } disabled:opacity-50 disabled:cursor-not-allowed text-sm`}
                >
                  <RefreshCw className="w-4 h-4" />
                  Lấy chỉ số
                </button>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Ngày</label>
                  <input 
                    type="number" 
                    value={section.dateTime.day}
                    onChange={(e) => updateSectionDateTime(section.id, 'day', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 text-center"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Tháng</label>
                  <input 
                    type="number" 
                    value={section.dateTime.month}
                    onChange={(e) => updateSectionDateTime(section.id, 'month', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 text-center"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Năm</label>
                  <input 
                    type="number" 
                    value={section.dateTime.year}
                    onChange={(e) => updateSectionDateTime(section.id, 'year', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 text-center"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Giờ</label>
                  <input 
                    type="number" 
                    value={section.dateTime.hour}
                    onChange={(e) => updateSectionDateTime(section.id, 'hour', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 text-center"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Phút</label>
                  <input 
                    type="number" 
                    value={section.dateTime.minute}
                    onChange={(e) => updateSectionDateTime(section.id, 'minute', e.target.value)}
                    className="w-full p-2 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 text-center"
                  />
                </div>
              </div>
            </div>


            <div className="flex-1 overflow-x-auto max-h-[500px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Công tơ</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">PG (Tổng)</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">BT (B1)</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">CD (B2)</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">TD (B3)</th>
                    <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">VC (Vô công)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {meters.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-400 italic text-sm">Chưa có danh sách công tơ</td>
                    </tr>
                  ) : (
                    meters.map((m) => {
                      const reading = section.readings[m.MeterNo];
                      return (
                        <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-bold text-slate-700 text-xs">{m.MeterNo}</td>
                          <td className="px-4 py-3 text-center text-xs font-bold">
                            {reading?.status === 'loading' ? (
                              <RefreshCw className="w-3 h-3 animate-spin mx-auto text-slate-300" />
                            ) : (
                              <span className={reading?.status === 'error' ? 'text-red-400' : 'text-emerald-600'}>
                                {reading?.pg || '-'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-xs font-bold">
                            {reading?.status === 'loading' ? (
                              <RefreshCw className="w-3 h-3 animate-spin mx-auto text-slate-300" />
                            ) : (
                              <span className={reading?.status === 'error' ? 'text-red-400' : 'text-blue-600'}>
                                {reading?.bt || '-'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-xs font-bold">
                            {reading?.status === 'loading' ? (
                              <RefreshCw className="w-3 h-3 animate-spin mx-auto text-slate-300" />
                            ) : (
                              <span className={reading?.status === 'error' ? 'text-red-400' : 'text-orange-600'}>
                                {reading?.cd || '-'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-xs font-bold">
                            {reading?.status === 'loading' ? (
                              <RefreshCw className="w-3 h-3 animate-spin mx-auto text-slate-300" />
                            ) : (
                              <span className={reading?.status === 'error' ? 'text-red-400' : 'text-purple-600'}>
                                {reading?.td || '-'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center text-xs font-bold">
                            {reading?.status === 'loading' ? (
                              <RefreshCw className="w-3 h-3 animate-spin mx-auto text-slate-300" />
                            ) : (
                              <span className={reading?.status === 'error' ? 'text-red-400' : 'text-slate-600'}>
                                {reading?.vc || '-'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Part 3: Detailed Meter List & Consumption Calculation */}
      <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50/30">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
              <TableIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">Chi tiết sản lượng</h3>
              <p className="text-slate-500 text-xs mt-0.5">Tính toán dựa trên chênh lệch 2 đợt lấy chỉ số</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button 
              onClick={exportToExcel}
              disabled={meters.length === 0}
              className="px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50 text-sm"
            >
              <Download className="w-4 h-4" />
              Xuất Excel
            </button>
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
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Số công tơ</th>
                <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Trạm (Line)</th>
                <th className="px-4 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">HSN</th>
                <th className="px-4 py-4 text-[10px] font-bold text-emerald-600 uppercase tracking-widest text-center">Tổng (kWh)</th>
                <th className="px-4 py-4 text-[10px] font-bold text-blue-600 uppercase tracking-widest text-center">Biểu 1 (kWh)</th>
                <th className="px-4 py-4 text-[10px] font-bold text-orange-600 uppercase tracking-widest text-center">Biểu 2 (kWh)</th>
                <th className="px-4 py-4 text-[10px] font-bold text-purple-600 uppercase tracking-widest text-center">Biểu 3 (kWh)</th>
                <th className="px-4 py-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest text-center">Vô công (kVarh)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {isLoadingMeters ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-slate-300" />
                  </td>
                </tr>
              ) : meters.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-slate-400 italic">Không có dữ liệu công tơ</td>
                </tr>
              ) : (
                meters.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-slate-700 text-xs">{m.MeterNo}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{m.Line || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs text-center font-mono">{m.HSN || '—'}</td>
                    <td className="px-4 py-3 text-center font-bold text-emerald-600 text-xs">
                      {formatConsumption(getConsumptionValue(m.MeterNo, 'pg', m.HSN))}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-blue-600 text-xs">
                      {formatConsumption(getConsumptionValue(m.MeterNo, 'bt', m.HSN))}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-orange-600 text-xs">
                      {formatConsumption(getConsumptionValue(m.MeterNo, 'cd', m.HSN))}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-purple-600 text-xs">
                      {formatConsumption(getConsumptionValue(m.MeterNo, 'td', m.HSN))}
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-600 text-xs">
                      {formatConsumption(getConsumptionValue(m.MeterNo, 'vc', m.HSN))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}



