import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS, ID_TO_AREA } from '../lib/pocketbase';
import { Handover, Situation, ElectricShift } from '../types';
import { 
  Plus, Trash2, Edit2, X, CheckCircle2, Search, 
  Calendar, Clock, User, Users, Zap, Download, ChevronDown, 
  ChevronRight, RefreshCw, ClipboardList, Package,
  MessageSquare, FileText, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pdfMake from 'pdfmake/build/pdfmake';

// Initialize pdfMake fonts with Times New Roman from CDN
const TINOS_FONTS = {
  Tinos: {
    normal: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Regular.ttf',
    bold: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Bold.ttf',
    italics: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Italic.ttf',
    bolditalics: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-BoldItalic.ttf'
  }
};

export default function HandoverManager() {
  const [logs, setLogs] = useState<Handover[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState({ 
    month: (new Date().getMonth() + 1).toString().padStart(2, '0'),
    area: '' 
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<Handover | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    area: AREAS[0],
    shift: 'Ca 1',
    main_duty: '',
    sub_duty: '',
    main_power: '',
    sub_power: '',
    notes: '',
    equipment: '',
    opinions: '',
  });
  const [situationRows, setSituationRows] = useState<Situation[]>([]);
  const [staffList, setStaffList] = useState<ElectricShift[]>([]);

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

  const loadStaff = useCallback(async (area: string) => {
    try {
      const result = await pb.collection('Electric_shift').getFullList<ElectricShift>({
        filter: `area = '${area.replace(/'/g, "\\'")}'`,
        sort: 'IDnum',
        requestKey: null
      });
      setStaffList(result);
    } catch (err: any) {
      console.error('Error loading staff:', err);
      // Optional: set an error state if you want to show it in UI
    }
  }, []);

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const filterParts: string[] = [];
      if (filter.area) {
        filterParts.push(`area = '${filter.area.replace(/'/g, "\\'")}'`);
      } else if (userAreas.length > 0) {
        const areaFilters = userAreas.map(a => `area = '${a.replace(/'/g, "\\'")}'`).join(' || ');
        filterParts.push(`(${areaFilters})`);
      }

      if (filter.month) {
        const startOfMonth = `2026-${filter.month}-01 00:00:00`;
        const nextMonth = parseInt(filter.month) + 1;
        const endYear = nextMonth > 12 ? 2027 : 2026;
        const endMonth = nextMonth > 12 ? '01' : nextMonth.toString().padStart(2, '0');
        const endOfMonth = `${endYear}-${endMonth}-01 00:00:00`;
        filterParts.push(`date >= '${startOfMonth}' && date < '${endOfMonth}'`);
      }

      const result = await pb.collection('handovers').getFullList<Handover>({
        filter: filterParts.join(' && '),
        sort: '-date',
        requestKey: null
      });
      setLogs(result);
    } catch (err: any) {
      console.error('FULL ERROR LOGS:', err);
      alert(`Lỗi tải nhật ký (Status: ${err.status}): ` + (err.data?.message || err.message));
    } finally {
      setIsLoading(false);
    }
  }, [filter, userAreas]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (formData.area) {
      loadStaff(formData.area);
    }
  }, [formData.area, loadStaff]);

  const groupedLogs = logs.reduce((acc: { id: string, date: string, area: string, records: Handover[] }[], log) => {
    const logDate = log.date.split(' ')[0];
    const groupId = `${logDate}-${log.area}`;
    const existing = acc.find(g => g.id === groupId);
    if (existing) {
      existing.records.push(log);
      existing.records.sort((a, b) => a.shift.localeCompare(b.shift));
    } else {
      acc.push({ id: groupId, date: logDate, area: log.area, records: [log] });
    }
    return acc;
  }, []);

  // Handlers
  const startAddLog = () => {
    setIsModalOpen(true);
    setEditingLogId(null);
    setFormData({
      date: new Date().toISOString().split('T')[0],
      area: effectiveAreas[0] || AREAS[0],
      shift: 'Ca 1',
      main_duty: '',
      sub_duty: '',
      main_power: '',
      sub_power: '',
      notes: '',
      equipment: '',
      opinions: '',
    });
    setSituationRows([{ time: '', content: '' }]);
  };

  const startEditLog = (log: Handover) => {
    setEditingLogId(log.id);
    setIsModalOpen(true);
    setFormData({
      date: log.date.split(' ')[0],
      area: log.area,
      shift: log.shift,
      main_duty: log.main_duty,
      sub_duty: log.sub_duty,
      main_power: log.main_power,
      sub_power: log.sub_power,
      notes: log.notes,
      equipment: log.equipment,
      opinions: log.opinions,
    });
    setSituationRows(log.situations && log.situations.length > 0 ? log.situations : [{ time: '', content: '' }]);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setIsDetailOpen(false);
    setEditingLogId(null);
    setSelectedLog(null);
  };

  const openDetail = (log: Handover) => {
    setSelectedLog(log);
    setIsDetailOpen(true);
  };

  const saveLog = async () => {
    try {
      const data = {
        ...formData,
        situations: situationRows.filter(r => r.time || r.content)
      };
      if (editingLogId) {
        await pb.collection('handovers').update(editingLogId, data);
      } else {
        await pb.collection('handovers').create(data);
      }
      closeModal();
      loadLogs();
    } catch (err) {
      console.error('Save log error:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await pb.collection('handovers').delete(id);
      loadLogs();
    } catch (err) {
      console.error('Delete log error:', err);
    }
  };

  const handleAutoAssign = () => {
    if (staffList.length < 6) return;
    
    const date = new Date(formData.date);
    if (isNaN(date.getTime())) return;

    const epoch = new Date(2026, 0, 1);
    const diffTime = date.getTime() - epoch.getTime();
    const dayIndex = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    const monthOffset = date.getMonth() * 2;
    const rotation = Math.abs(dayIndex + monthOffset) % 6;
    
    const rotatedStaff = [...staffList].sort((a, b) => a.IDnum - b.IDnum);
    for(let i = 0; i < rotation; i++) {
      rotatedStaff.push(rotatedStaff.shift()!);
    }

    let main = '';
    let sub = '';

    if (formData.shift === 'Ca 1') {
      main = rotatedStaff[0].Name;
      sub = rotatedStaff[1].Name;
    } else if (formData.shift === 'Ca 2') {
      main = rotatedStaff[2].Name;
      sub = rotatedStaff[3].Name;
    } else if (formData.shift === 'Ca 3') {
      main = rotatedStaff[4].Name;
      sub = rotatedStaff[5].Name;
    }

    setFormData(prev => ({ ...prev, main_duty: main, sub_duty: sub }));
  };

  // PDF Export Logic (Copied from Dashboard.tsx)
  const getLogPDFContent = (log: Handover) => {
    let caTime = '';
    const start = new Date(log.date);
    let end = new Date(log.date);
    if (log.shift === 'Ca 1') caTime = `Từ 06:00 ngày ${start.toLocaleDateString('vi-VN')} đến 14:00 ngày ${start.toLocaleDateString('vi-VN')}`;
    else if (log.shift === 'Ca 2') caTime = `Từ 14:00 ngày ${start.toLocaleDateString('vi-VN')} đến 22:00 ngày ${start.toLocaleDateString('vi-VN')}`;
    else if (log.shift === 'Ca 3') {
      end.setDate(end.getDate() + 1);
      caTime = `Từ 22:00 ngày ${start.toLocaleDateString('vi-VN')} đến 06:00 ngày ${end.toLocaleDateString('vi-VN')}`;
    }
    const giaoCaStr = log.shift === 'Ca 1' ? `14:00 ngày ${start.toLocaleDateString('vi-VN')}`
      : log.shift === 'Ca 2' ? `22:00 ngày ${start.toLocaleDateString('vi-VN')}`
      : `06:00 ngày ${end.toLocaleDateString('vi-VN')}`;
    const showSituations = (log.situations || []).slice(0, 6);
    const padRows = Array.from({ length: 6 - showSituations.length }, () => ['', '']);
    const displaySituations = showSituations.map(s => [
      s.time || '',
      (s.content || '').length > 200 ? (s.content || '').substring(0, 200) + '...' : (s.content || '')
    ]);
    return [
      { text: `${log.shift} ${caTime}`, style: 'header', alignment: 'center', margin: [0, 0, 0, 10] },
      { text: 'NHÂN VIÊN VẬN HÀNH CÁC ĐƠN VỊ (ghi rõ họ tên)', style: 'subheader', margin: [0, 0, 0, 6] },
      {
        table: { headerRows: 1, widths: ['25%', '37.5%', '37.5%'], body: [
          [{ text: '', fillColor: '#f3f4f6', bold: true, alignment: 'center' },
           { text: 'Trực đội QLVH', fillColor: '#f3f4f6', bold: true, alignment: 'center' },
           { text: 'Trực điều độ điện lực', fillColor: '#f3f4f6', bold: true, alignment: 'center' }],
          ['Trực chính', log.main_duty || '', log.main_power || ''],
          ['Trực phụ', log.sub_duty || '', log.sub_power || '']
        ]},
        layout: { hLineWidth:()=>1, vLineWidth:()=>1, hLineColor:()=>'#9ca3af', vLineColor:()=>'#9ca3af', padding: [8,8,8,8] }
      },
      { text: 'I. TÌNH HÌNH VẬN HÀNH TRONG CA', style: 'subheader', margin: [0, 8, 0, 5] },
      {
        table: {
          headerRows: 1,
          widths: ['13%', '*'],
          heights: [22, 28, 28, 28, 28, 28, 28],
          body: [
            [{ text: 'Thời gian', fillColor: '#f3f4f6', bold: true, alignment: 'center' },
             { text: 'Nội dung', fillColor: '#f3f4f6', bold: true, alignment: 'center' }],
            ...displaySituations,
            ...padRows
          ]
        },
        layout: { hLineWidth:()=>1, vLineWidth:()=>1, hLineColor:()=>'#9ca3af', vLineColor:()=>'#9ca3af', padding: [8,8,8,8] }
      },
      { text: 'II. PHẦN GIAO NHẬN CA', style: 'subheader', margin: [0, 8, 0, 5] },
      { text: '1. Những lưu ý và tồn tại ca sau cần giải quyết:', style: 'boldSection', margin: [0, 4, 0, 3] },
      { text: log.notes || 'Không có', margin: [0, 0, 0, 8] },
      { text: '2. Trang bị vận hành, thông tin liên lạc, vệ sinh công nghiệp:', style: 'boldSection', margin: [0, 4, 0, 3] },
      { text: log.equipment || 'Không có', margin: [0, 0, 0, 8] },
      {
        table: {
          headerRows: 1,
          widths: ['26%', '37%', '37%'],
          heights: [22, 30, 30],
          body: [
            [
              { text: 'Giờ giao ca', fillColor: '#f3f4f6', bold: true, alignment: 'center' },
              { text: 'Người nhận ca ký', fillColor: '#f3f4f6', bold: true, alignment: 'center' },
              { text: 'Người giao ca ký', fillColor: '#f3f4f6', bold: true, alignment: 'center' }
            ],
            [
              { text: giaoCaStr, rowSpan: 2, alignment: 'center', bold: true },
              { text: ' ', alignment: 'center' },
              { text: ' ', alignment: 'center' }
            ],
            ['', { text: ' ', alignment: 'center' }, { text: ' ', alignment: 'center' }]
          ]
        },
        layout: { hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => '#9ca3af', vLineColor: () => '#9ca3af', padding: [8, 8, 8, 8] }
      },
      { text: '3. Ý kiến lãnh đạo đơn vị:', style: 'boldSection', margin: [0, 8, 0, 3] },
      { text: log.opinions || 'Không có', margin: [0, 0, 0, 0] }
    ];
  };

  const exportToPDF = async (log: Handover) => {
    try {
      const docDefinition: any = {
        pageSize: 'A4',
        pageMargins: [35, 30, 35, 30],
        defaultStyle: { font: 'Tinos', fontSize: 12, lineHeight: 1.4 },
        content: getLogPDFContent(log),
        styles: {
          header: { fontSize: 13, bold: true },
          subheader: { fontSize: 12, bold: true },
          boldSection: { bold: true, fontSize: 12 }
        }
      };
      pdfMake.fonts = TINOS_FONTS;
      pdfMake.createPdf(docDefinition).download(`SoTruc_${log.area}_${log.shift}_${new Date(log.date).toLocaleDateString('vi-VN').replace(/\//g, '-')}.pdf`);
    } catch (err) {
      console.error(err);
    }
  };

  const exportMultipleToPDF = async () => {
    if (selectedIds.size === 0) return;
    try {
      const selectedLogs = logs
        .filter(log => selectedIds.has(log.id))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const combinedContent: any[] = [];
      selectedLogs.forEach((log, index) => {
        combinedContent.push(...getLogPDFContent(log));
        if (index < selectedLogs.length - 1) {
          combinedContent.push({ text: '', pageBreak: 'after' });
        }
      });
      const docDefinition: any = {
        pageSize: 'A4',
        pageMargins: [35, 30, 35, 30],
        defaultStyle: { font: 'Tinos', fontSize: 12, lineHeight: 1.4 },
        content: combinedContent,
        styles: {
          header: { fontSize: 13, bold: true },
          subheader: { fontSize: 12, bold: true },
          boldSection: { bold: true, fontSize: 12 }
        }
      };
      pdfMake.fonts = TINOS_FONTS;
      pdfMake.createPdf(docDefinition).download(`SoTruc_TongHop_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.pdf`);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleGroupExpand = (groupId: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupId)) newExpanded.delete(groupId);
    else newExpanded.add(groupId);
    setExpandedGroups(newExpanded);
  };

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) newSelection.delete(id);
    else newSelection.add(id);
    setSelectedIds(newSelection);
  };

  const toggleGroupSelection = (records: Handover[]) => {
    const newSelection = new Set(selectedIds);
    const allSelected = records.every(r => newSelection.has(r.id));
    if (allSelected) records.forEach(r => newSelection.delete(r.id));
    else records.forEach(r => newSelection.add(r.id));
    setSelectedIds(newSelection);
  };

  const uniqueDaysCount = new Set(logs.map(log => log.date.split(' ')[0])).size;

  return (
    <div className="space-y-8 relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Sổ nhật ký điện tử</h2>
          <p className="text-slate-500 text-sm mt-1">Quản lý lịch trực và tình hình vận hành</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select 
            value={filter.area} 
            onChange={(e) => setFilter({ ...filter, area: e.target.value })}
            className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
          >
            <option value="">Tất cả khu vực</option>
            {effectiveAreas.map(area => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>
          <select 
            value={filter.month} 
            onChange={(e) => setFilter({ ...filter, month: e.target.value })}
            className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
          >
            {Array.from({ length: 12 }, (_, i) => {
              const m = (i + 1).toString().padStart(2, '0');
              return <option key={m} value={m}>Tháng {i + 1}</option>;
            })}
          </select>
          <button 
            onClick={startAddLog}
            className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Tạo lịch trực
          </button>
          <button 
            disabled={selectedIds.size === 0}
            onClick={exportMultipleToPDF}
            className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${selectedIds.size > 0 ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
          >
            <Download className="w-5 h-5" />
            PDF {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {/* Modal Form */}
        <AnimatePresence>
          {isModalOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeModal}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
              >
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
                      <ClipboardList className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">{editingLogId ? 'Sửa lịch trực' : 'Tạo lịch trực mới'}</h3>
                      <p className="text-slate-500 text-xs mt-0.5">Vui lòng điền đầy đủ thông tin vận hành trong ca</p>
                    </div>
                  </div>
                  <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded-xl transition-colors">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Ngày trực</label>
                      <input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Khu vực</label>
                      <select value={formData.area} onChange={(e) => setFormData({ ...formData, area: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500">
                        {effectiveAreas.map(area => <option key={area} value={area}>{area}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Ca trực</label>
                      <select value={formData.shift} onChange={(e) => setFormData({ ...formData, shift: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="Ca 1">Ca 1 (06:00 - 14:00)</option>
                        <option value="Ca 2">Ca 2 (14:00 - 22:00)</option>
                        <option value="Ca 3">Ca 3 (22:00 - 06:00)</option>
                      </select>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5 text-emerald-600" /> Nhân sự trực</h4>
                      <button onClick={handleAutoAssign} className="text-xs font-bold text-emerald-600 bg-white border border-emerald-100 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors">Tự động phân ca</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trực đội QLVH</div>
                        <select value={formData.main_duty} onChange={(e) => setFormData({ ...formData, main_duty: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                          <option value="">Chọn trực chính</option>
                          {staffList.map(s => <option key={s.id} value={s.Name}>{s.Name}</option>)}
                        </select>
                        <select value={formData.sub_duty} onChange={(e) => setFormData({ ...formData, sub_duty: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                          <option value="">Chọn trực phụ</option>
                          {staffList.map(s => <option key={s.id} value={s.Name}>{s.Name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trực điều độ điện lực</div>
                        <input type="text" placeholder="Trực chính điện lực" value={formData.main_power} onChange={(e) => setFormData({ ...formData, main_power: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                        <input type="text" placeholder="Trực phụ điện lực" value={formData.sub_power} onChange={(e) => setFormData({ ...formData, sub_power: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2"><Activity className="w-5 h-5 text-emerald-600" /> Tình hình vận hành trong ca</h4>
                      <button 
                        onClick={() => setSituationRows([...situationRows, { time: '', content: '' }])}
                        className="text-xs font-bold text-emerald-600 flex items-center gap-1 hover:underline"
                      >
                        <Plus className="w-4 h-4" /> Thêm dòng
                      </button>
                    </div>
                    <div className="border border-slate-200 rounded-2xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 text-left font-bold text-slate-500 w-32">Thời gian</th>
                            <th className="px-4 py-3 text-left font-bold text-slate-500">Nội dung</th>
                            <th className="px-4 py-3 w-12"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {situationRows.map((row, idx) => (
                            <tr key={idx}>
                              <td className="p-2">
                                <input 
                                  type="text" 
                                  placeholder="08:00"
                                  value={row.time} 
                                  onChange={(e) => {
                                    const newRows = [...situationRows];
                                    newRows[idx].time = e.target.value;
                                    setSituationRows(newRows);
                                  }}
                                  className="w-full p-2 bg-transparent outline-none focus:bg-slate-50 rounded-lg"
                                />
                              </td>
                              <td className="p-2">
                                <input 
                                  type="text" 
                                  placeholder="Nội dung công việc..."
                                  value={row.content} 
                                  onChange={(e) => {
                                    const newRows = [...situationRows];
                                    newRows[idx].content = e.target.value;
                                    setSituationRows(newRows);
                                  }}
                                  className="w-full p-2 bg-transparent outline-none focus:bg-slate-50 rounded-lg"
                                />
                              </td>
                              <td className="p-2">
                                <button onClick={() => setSituationRows(situationRows.filter((_, i) => i !== idx))} className="p-1 text-slate-300 hover:text-red-500">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Những lưu ý và tồn tại ca sau cần giải quyết</label>
                      <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 min-h-[100px]" placeholder="Nhập các lưu ý cho ca sau..." />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Trang bị vận hành, thông tin liên lạc, vệ sinh công nghiệp</label>
                      <textarea value={formData.equipment} onChange={(e) => setFormData({ ...formData, equipment: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 min-h-[100px]" placeholder="Tình trạng trang thiết bị..." />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Ý kiến lãnh đạo đơn vị</label>
                      <textarea value={formData.opinions} onChange={(e) => setFormData({ ...formData, opinions: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500 min-h-[100px]" placeholder="Ý kiến chỉ đạo..." />
                    </div>
                  </div>
                </div>

                <div className="p-8 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
                  <button onClick={closeModal} className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-100 transition-all">Hủy bỏ</button>
                  <button onClick={saveLog} className="px-8 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20">Lưu lịch trực</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Detail Modal */}
        <AnimatePresence>
          {isDetailOpen && selectedLog && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeModal}
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
              >
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20">
                      <FileText className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">Chi tiết lịch trực</h3>
                      <p className="text-slate-500 text-xs mt-0.5">{new Date(selectedLog.date).toLocaleDateString('vi-VN')} - {selectedLog.shift} - {selectedLog.area}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => exportToPDF(selectedLog)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Tải PDF"><Download className="w-6 h-6" /></button>
                    <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded-xl transition-colors">
                      <X className="w-6 h-6 text-slate-400" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                  {/* Row 1: Personnel */}
                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 space-y-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Users className="w-4 h-4" /> Nhân sự trực</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Trực chính QLVH</div>
                        <p className="text-sm font-bold text-slate-700">{selectedLog.main_duty || '—'}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Trực phụ QLVH</div>
                        <p className="text-sm font-bold text-slate-700">{selectedLog.sub_duty || '—'}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Trực chính Điện lực</div>
                        <p className="text-sm font-bold text-slate-700">{selectedLog.main_power || '—'}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Trực phụ Điện lực</div>
                        <p className="text-sm font-bold text-slate-700">{selectedLog.sub_power || '—'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Situations Table */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Activity className="w-4 h-4" /> Tình hình vận hành trong ca</h4>
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-6 py-3 text-left font-bold text-slate-500 w-32">Thời gian</th>
                            <th className="px-6 py-3 text-left font-bold text-slate-500">Nội dung công việc</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedLog.situations && selectedLog.situations.length > 0 ? (
                            selectedLog.situations.map((s, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4 font-bold text-emerald-600">{s.time}</td>
                                <td className="px-6 py-4 text-slate-600 leading-relaxed">{s.content}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className="px-6 py-12 text-center text-slate-400 italic">Không có ghi nhận tình hình vận hành</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Rows 3, 4, 5: Notes, Equipment, Opinions */}
                  <div className="space-y-8">
                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <MessageSquare className="w-4 h-4" /> 1. Những lưu ý và tồn tại ca sau cần giải quyết
                      </h5>
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 text-sm text-slate-600 leading-relaxed min-h-[100px] whitespace-pre-wrap">
                        {selectedLog.notes || 'Không có ghi chú nào cho ca sau.'}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Package className="w-4 h-4" /> 2. Trang bị vận hành, thông tin liên lạc, vệ sinh công nghiệp
                      </h5>
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 text-sm text-slate-600 leading-relaxed min-h-[100px] whitespace-pre-wrap">
                        {selectedLog.equipment || 'Tình trạng trang thiết bị và vệ sinh bình thường.'}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <User className="w-4 h-4" /> 3. Ý kiến lãnh đạo đơn vị
                      </h5>
                      <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 text-sm text-slate-600 leading-relaxed min-h-[100px] whitespace-pre-wrap font-medium italic">
                        {selectedLog.opinions || 'Chưa có ý kiến chỉ đạo từ lãnh đạo.'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-8 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
                  <button onClick={() => { closeModal(); startEditLog(selectedLog); }} className="px-8 py-3 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2">
                    <Edit2 className="w-5 h-5" /> Sửa lịch trực
                  </button>
                  <button onClick={closeModal} className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-100 transition-all">Đóng</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <RefreshCw className="w-10 h-10 animate-spin mb-4" />
            <p>Đang tải dữ liệu...</p>
          </div>
        ) : groupedLogs.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-20 text-center text-slate-400 border border-dashed border-slate-200">
            <ClipboardList className="w-12 h-12 mx-auto mb-4 opacity-20" />
            <p>Chưa có lịch trực nào trong tháng này</p>
          </div>
        ) : (
          groupedLogs.map((group) => (
            <div key={group.id} className={`bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm transition-all card-${AREA_TO_CLASS[group.area] || 'default'}`}>
              <div 
                onClick={() => toggleGroupExpand(group.id)}
                className="p-5 flex items-center justify-between gap-4 cursor-pointer hover:bg-white/50 transition-colors"
              >
                <div className="flex items-center gap-5">
                  <div className="p-3 bg-white rounded-2xl shadow-sm">
                    <Calendar className="w-6 h-6 text-slate-500" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-bold text-slate-800 text-lg">{new Date(group.date).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</h3>
                      <span className={`kcn-badge kcn-${AREA_TO_CLASS[group.area] || 'default'}`}>
                        {group.area}
                      </span>
                    </div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">{group.records.length} ca trực ghi nhận</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      checked={group.records.every(r => selectedIds.has(r.id))} 
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleGroupSelection(group.records);
                      }} 
                      className="w-5 h-5 rounded-lg border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" 
                    />
                  </div>
                  {expandedGroups.has(group.id) ? <ChevronDown className="w-6 h-6 text-slate-400" /> : <ChevronRight className="w-6 h-6 text-slate-400" />}
                </div>
              </div>

              <AnimatePresence>
                {expandedGroups.has(group.id) && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-slate-100 bg-white/30"
                  >
                    <div className="divide-y divide-slate-100">
                      {group.records.map((log) => (
                        <div key={log.id} className="flex flex-col">
                          <div 
                            onClick={() => openDetail(log)}
                            className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-white transition-colors"
                          >
                            <div className="flex items-center gap-6 flex-1">
                              <div className="w-20 text-center">
                                <div className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-lg uppercase tracking-tight">{log.shift}</div>
                              </div>
                              <div className="hidden md:flex items-center gap-4 flex-1">
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <User className="w-3.5 h-3.5" />
                                  <span className="font-medium truncate max-w-[150px]">{log.main_duty}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                  <Users className="w-3.5 h-3.5" />
                                  <span className="truncate max-w-[150px]">{log.sub_duty || '—'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={(e) => { e.stopPropagation(); exportToPDF(log); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Tải PDF"><Download className="w-4 h-4" /></button>
                              <button onClick={(e) => { e.stopPropagation(); startEditLog(log); }} className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all" title="Sửa"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={(e) => { e.stopPropagation(); handleDelete(log.id); }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Xóa"><Trash2 className="w-4 h-4" /></button>
                              <input 
                                type="checkbox" 
                                checked={selectedIds.has(log.id)} 
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelection(log.id);
                                }} 
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer" 
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}
      </div>

      {/* Floating Stats Notification */}
      {!isLoading && logs.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="fixed bottom-8 right-8 z-40"
        >
          <div className="bg-white/80 backdrop-blur-md border border-emerald-100 shadow-2xl shadow-emerald-600/10 rounded-2xl px-5 py-3 flex items-center gap-3 group hover:bg-white transition-all">
            <div className="p-2 bg-emerald-600 rounded-xl shadow-lg shadow-emerald-600/20 group-hover:scale-110 transition-transform">
              <Calendar className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider leading-none mb-1">Thống kê tháng {filter.month}</p>
              <p className="text-sm font-black text-slate-800">
                <span className="text-emerald-600">{uniqueDaysCount}</span> ngày trực <span className="text-slate-300 mx-1">•</span> <span className="text-blue-600">{logs.length}</span> ca
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
