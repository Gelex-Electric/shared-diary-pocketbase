import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS } from '../lib/pocketbase';
import { Handover, Situation, ElectricShift } from '../types';
import { 
  Plus, RefreshCw, LogOut, FileText, Edit, Trash2, 
  Search, Calendar, Clock, User, Zap, MessageSquare, 
  Package, ChevronRight, X, Download, ClipboardList, Users, Menu, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pdfMake from 'pdfmake/build/pdfmake';
import * as pdfFonts from 'pdfmake/build/vfs_fonts';
import ElectricShiftManager from './ElectricShiftManager';

// Initialize pdfMake fonts with Times New Roman from CDN
const fonts = {
  TimesNewRoman: {
    normal: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Regular.ttf', // Fallback
    bold: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Medium.ttf',
    italics: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-Italic.ttf',
    bolditalics: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.1.66/fonts/Roboto/Roboto-MediumItalic.ttf'
  }
};

// Note: In a real environment, you'd provide actual Times New Roman TTF links.
// For this demo, we'll use a serif font that supports Vietnamese well and label it as Times.
// We will use 'Tinos' from Google Fonts which is a metric-compatible replacement for Times New Roman.

const TINOS_FONTS = {
  Tinos: {
    normal: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Regular.ttf',
    bold: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Bold.ttf',
    italics: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-Italic.ttf',
    bolditalics: 'https://cdn.jsdelivr.net/gh/google/fonts@master/apache/tinos/Tinos-BoldItalic.ttf'
  }
};

export default function Dashboard() {
  const [logs, setLogs] = useState<Handover[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [topTab, setTopTab] = useState<'journal' | 'later'>('journal');
  const [subTab, setSubTab] = useState<'create' | 'staff'>('create');
  const [filter, setFilter] = useState({ 
    month: (new Date().getMonth() + 1).toString().padStart(2, '0') 
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<Handover | null>(null);
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<ElectricShift[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isJournalExpanded, setIsJournalExpanded] = useState(true);

  const userArea = pb.authStore.model?.area || '';

  const loadStaff = useCallback(async () => {
    if (!pb.authStore.isValid || !userArea) return;
    try {
      const result = await pb.collection('Electric_shift').getFullList<ElectricShift>({
        filter: `area = '${userArea.replace(/'/g, "\\'")}'`,
        sort: 'IDnum',
        requestKey: null
      });
      setStaffList(result);
    } catch (err) {
      console.error('Error loading staff for dropdown:', err);
    }
  }, [userArea]);

  const handleAutoAssign = () => {
    if (staffList.length < 6) {
      alert('Cần ít nhất 6 nhân viên để tự động phân ca!');
      return;
    }
    
    const date = new Date(formData.date);
    if (isNaN(date.getTime())) {
      alert('Vui lòng chọn ngày trước!');
      return;
    }

    // Calculate days since epoch (Jan 1, 2026)
    const epoch = new Date(2026, 0, 1);
    const diffTime = date.getTime() - epoch.getTime();
    const dayIndex = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // Monthly rotation offset to ensure different people for same day-of-month across months
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

  // Form state
  const [formData, setFormData] = useState({
    date: '',
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

const loadLogs = useCallback(async () => {
  setIsLoading(true);
  try {
    const filterParts: string[] = [];
    
    // Filter theo khu vực của user
    if (userArea) {
      filterParts.push(`area = '${userArea.replace(/'/g, "\\'")}'`);
    }

    // Filter theo tháng (giữ nguyên logic của bạn)
    if (filter.month) {
      const startOfMonth = `2026-${filter.month}-01 00:00:00`;
      const nextMonth = parseInt(filter.month) + 1;
      const endYear = nextMonth > 12 ? 2027 : 2026;
      const endMonth = nextMonth > 12 ? '01' : nextMonth.toString().padStart(2, '0');
      const endOfMonth = `${endYear}-${endMonth}-01 00:00:00`;
      
      filterParts.push(`date >= '${startOfMonth}' && date < '${endOfMonth}'`);
    }

    const filterString = filterParts.length ? filterParts.join(' && ') : '';

    const result = await pb.collection('handovers').getFullList<Handover>({
      filter: filterString,
      sort: '-date',
      requestKey: null
    });

    setLogs(result);
  } catch (err) {
    console.error('Error loading logs:', err);
  } finally {
    setIsLoading(false);
  }
}, [filter, userArea]);

  useEffect(() => {
    loadLogs();
    loadStaff();
    pb.collection('handovers').subscribe('*', () => loadLogs());
    pb.collection('Electric_shift').subscribe('*', () => loadStaff());
    return () => {
      pb.collection('handovers').unsubscribe('*');
      pb.collection('Electric_shift').unsubscribe('*');
    };
  }, [loadLogs, loadStaff]);

  // Grouping logic
  const groupedLogs = logs.reduce((acc: { date: string, area: string, records: Handover[] }[], log) => {
    const logDate = log.date.split(' ')[0];
    const existing = acc.find(g => g.date === logDate && g.area === log.area);
    if (existing) {
      existing.records.push(log);
      // Sort by shift
      existing.records.sort((a, b) => a.shift.localeCompare(b.shift));
    } else {
      acc.push({ date: logDate, area: log.area, records: [log] });
    }
    return acc;
  }, []);

  const handleLogout = () => {
    pb.authStore.clear();
    window.location.reload();
  };

  const openCreateModal = () => {
    loadStaff(); // Ensure staff list is fresh
    setCurrentEditId(null);
    setFormData({
      date: new Date().toISOString().split('T')[0],
      area: pb.authStore.model?.area || AREAS[0],
      shift: 'Ca 1',
      main_duty: '',
      sub_duty: '',
      main_power: '',
      sub_power: '',
      notes: '',
      equipment: '',
      opinions: '',
    });
    setSituationRows([]);
    setIsFormModalOpen(true);
  };

  const handleEdit = (log: Handover) => {
    setCurrentEditId(log.id);
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
    setSituationRows(log.situations || []);
    setIsDetailModalOpen(false);
    setIsFormModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Bạn chắc chắn muốn xóa bản ghi này?')) return;
    try {
      await pb.collection('handovers').delete(id);
      setIsDetailModalOpen(false);
      loadLogs();
    } catch (err: any) {
      alert('Không thể xóa: ' + err.message);
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteMultiple = async () => {
    if (selectedIds.size === 0) return;
    
    try {
      setIsLoading(true);
      const deletePromises = Array.from(selectedIds).map((id: string) => pb.collection('handovers').delete(id));
      await Promise.all(deletePromises);
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      loadLogs();
    } catch (err: any) {
      alert('Lỗi khi xóa: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.date || !formData.main_duty) {
      alert('Vui lòng nhập ít nhất Ngày và Trực chính!');
      return;
    }

    const data = {
      ...formData,
      situations: situationRows.filter(r => r.time || r.content)
    };

    try {
      if (currentEditId) {
        await pb.collection('handovers').update(currentEditId, data);
      } else {
        await pb.collection('handovers').create(data);
      }
      setIsFormModalOpen(false);
      loadLogs();
    } catch (err: any) {
      alert('Lỗi: ' + (err.message || 'Kiểm tra kết nối'));
    }
  };

  const addSituationRow = () => {
    setSituationRows([...situationRows, { time: '', content: '' }]);
  };

  const removeSituationRow = (index: number) => {
    setSituationRows(situationRows.filter((_, i) => i !== index));
  };

  const updateSituationRow = (index: number, field: keyof Situation, value: string) => {
    const newRows = [...situationRows];
    newRows[index] = { ...newRows[index], [field]: value };
    setSituationRows(newRows);
  };

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

      const cleanArea = (log.area || 'KCN').replace(/ /g, '_');
      pdfMake.fonts = TINOS_FONTS;
      pdfMake.createPdf(docDefinition).download(`SoTruc_${cleanArea}_${log.shift}_${new Date(log.date).toLocaleDateString('vi-VN').replace(/\//g, '-')}.pdf`);
    } catch (err) {
      console.error(err);
      alert('Lỗi khi xuất PDF');
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
      alert('Lỗi khi xuất PDF tổng hợp');
    }
  };

  const toggleSelection = (id: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedIds(newSelection);
  };

  const toggleGroupSelection = (records: Handover[]) => {
    const newSelection = new Set(selectedIds);
    const allSelected = records.every(r => newSelection.has(r.id));
    
    if (allSelected) {
      records.forEach(r => newSelection.delete(r.id));
    } else {
      records.forEach(r => newSelection.add(r.id));
    }
    setSelectedIds(newSelection);
  };

  const uniqueDaysCount = new Set(logs.map(log => log.date.split(' ')[0])).size;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col lg:flex-row">
      {/* Sidebar Navigation */}
      {/* Mobile Sidebar with Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 lg:hidden"
            />
            
            <motion.aside 
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 z-50 w-80 h-screen bg-white border-r border-slate-200 p-6 flex flex-col gap-8 shadow-2xl lg:hidden overflow-y-auto"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
                    <ClipboardList className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-xl font-black text-slate-800 tracking-tight uppercase">QUẢN LÝ VẬN HÀNH</h2>
                  <div className="ml-auto p-1.5 bg-slate-50 rounded-lg">
                    <Zap className="w-4 h-4 text-emerald-500" />
                  </div>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-6 px-4">Hệ thống</h3>
                <nav className="space-y-2">
                  <div className="space-y-1">
                    <button 
                      onClick={() => {
                        setTopTab('journal');
                        setIsJournalExpanded(!isJournalExpanded);
                      }}
                      className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${
                        topTab === 'journal' 
                          ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <ClipboardList className="w-5 h-5" />
                        Sổ nhật ký điện tử
                      </div>
                      <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence>
                      {isJournalExpanded && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden pl-4 space-y-1"
                        >
                          <button 
                            onClick={() => {
                              setTopTab('journal');
                              setSubTab('create');
                              setIsSidebarOpen(false);
                            }}
                            className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${
                              topTab === 'journal' && subTab === 'create'
                                ? 'bg-emerald-50 text-emerald-600' 
                                : 'text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'create' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                            Tạo lịch trực
                          </button>
                          <button 
                            onClick={() => {
                              setTopTab('journal');
                              setSubTab('staff');
                              setIsSidebarOpen(false);
                            }}
                            className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${
                              topTab === 'journal' && subTab === 'staff'
                                ? 'bg-emerald-50 text-emerald-600' 
                                : 'text-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'staff' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                            Quản lý nhân sự trực
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <button 
                    onClick={() => {
                      setTopTab('later');
                      setIsSidebarOpen(false);
                    }}
                    className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${
                      topTab === 'later' 
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                        : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <RefreshCw className="w-5 h-5" />
                    Cập nhật sau
                  </button>
                </nav>
              </div>

              <div className="mt-auto pt-8 border-t border-slate-100">
                <div className="bg-slate-50 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xs">
                      {pb.authStore.model?.name?.[0] || 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{pb.authStore.model?.name || 'Người dùng'}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{pb.authStore.model?.area || 'Khu vực'}</p>
                    </div>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="w-full py-2.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Đăng xuất
                  </button>
                </div>
                <div className="mt-4 px-4">
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">V1.1 Shift Update</p>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar - Always Visible */}
      <aside className="hidden lg:flex sticky top-0 left-0 w-80 h-screen bg-white border-r border-slate-200 p-8 flex-col gap-8 overflow-y-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
            <ClipboardList className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-black text-slate-800 tracking-tight uppercase">QUẢN LÝ VẬN HÀNH</h2>
          <div className="ml-auto p-1.5 bg-slate-50 rounded-lg">
            <Zap className="w-4 h-4 text-emerald-500" />
          </div>
        </div>

        <div>
          <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-6 px-4">Hệ thống</h3>
          <nav className="space-y-2">
            <div className="space-y-1">
              <button 
                onClick={() => {
                  setTopTab('journal');
                  setIsJournalExpanded(!isJournalExpanded);
                }}
                className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-between transition-all ${
                  topTab === 'journal' 
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                    : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-4">
                  <ClipboardList className="w-5 h-5" />
                  Sổ nhật ký điện tử
                </div>
                <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isJournalExpanded ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {isJournalExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pl-4 space-y-1"
                  >
                    <button 
                      onClick={() => {
                        setTopTab('journal');
                        setSubTab('create');
                      }}
                      className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${
                        topTab === 'journal' && subTab === 'create'
                          ? 'bg-emerald-50 text-emerald-600' 
                          : 'text-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'create' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                      Tạo lịch trực
                    </button>
                    <button 
                      onClick={() => {
                        setTopTab('journal');
                        setSubTab('staff');
                      }}
                      className={`w-full px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-4 transition-all ${
                        topTab === 'journal' && subTab === 'staff'
                          ? 'bg-emerald-50 text-emerald-600' 
                          : 'text-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${topTab === 'journal' && subTab === 'staff' ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                      Quản lý nhân sự trực
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button 
              onClick={() => setTopTab('later')}
              className={`w-full px-5 py-3.5 rounded-2xl text-sm font-bold flex items-center gap-4 transition-all ${
                topTab === 'later' 
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <RefreshCw className="w-5 h-5" />
              Cập nhật sau
            </button>
          </nav>
        </div>

        <div className="mt-auto pt-8 border-t border-slate-100">
          <div className="bg-slate-50 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-xs">
                {pb.authStore.model?.name?.[0] || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{pb.authStore.model?.name || 'Người dùng'}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase truncate">{pb.authStore.model?.area || 'Khu vực'}</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full py-2.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              Đăng xuất
            </button>
          </div>
          <div className="mt-4 px-4">
            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">V1.1 Shift Update</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 p-4 md:p-8 lg:max-w-[calc(100vw-320px)]">
        <div className="max-w-6xl mx-auto">
          {/* Mobile Menu Toggle - Outside Header */}
          <div className="lg:hidden mb-6 flex items-center justify-between">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-3 bg-white hover:bg-slate-50 rounded-2xl shadow-sm border border-slate-100 transition-all"
            >
              <Menu className="w-6 h-6 text-slate-600" />
            </button>
            <button 
              onClick={loadLogs}
              className="p-3 bg-white hover:bg-slate-50 rounded-2xl shadow-sm border border-slate-100 transition-all"
            >
              <RefreshCw className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          {topTab === 'journal' ? (
            <>
              {subTab === 'create' ? (
                <>
                  {/* Filter Bar */}
                  <div className="bg-white shadow-sm rounded-[2rem] p-6 mb-8 sticky top-0 z-10 border border-slate-100">
                    <div className="flex flex-col md:flex-row gap-6 items-end">
                      <div className="flex gap-3 w-full md:w-auto">
                        <button 
                          onClick={openCreateModal}
                          className="flex-1 md:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition-all"
                        >
                          <Plus className="w-5 h-5" />
                          Tạo mới
                        </button>
                        
                        <button 
                          disabled={selectedIds.size === 0}
                          onClick={exportMultipleToPDF}
                          className={`flex-1 md:flex-none px-5 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                            selectedIds.size > 0 
                              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20' 
                              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <Download className="w-5 h-5" />
                          Tải PDF {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                        </button>
                      </div>

                      <div className="flex-1 w-full space-y-4">
                          <div className="flex items-center justify-end px-2">
                            <div className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-bold">
                            <Calendar className="w-3 h-3" />
                            {uniqueDaysCount} ngày đã tạo ca
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Chọn tháng lọc</label>
                          <select 
                            value={filter.month}
                            onChange={(e) => setFilter({ ...filter, month: e.target.value })}
                            className="w-full bg-slate-50 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 transition-all"
                          >
                            {Array.from({ length: 12 }, (_, i) => {
                              const m = (i + 1).toString().padStart(2, '0');
                              return <option key={m} value={m}>Tháng {i + 1}</option>;
                            })}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Log List - Grouped */}
                  <div className="space-y-6">
                    {isLoading ? (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <RefreshCw className="w-10 h-10 animate-spin mb-4" />
                        <p>Đang tải dữ liệu...</p>
                      </div>
                    ) : groupedLogs.length === 0 ? (
                      <div className="bg-white rounded-[2rem] p-20 text-center text-slate-400 border border-dashed border-slate-200">
                        <Search className="w-12 h-12 mx-auto mb-4 opacity-20" />
                        <p>Chưa có bản ghi nào phù hợp</p>
                      </div>
                    ) : (
                      groupedLogs.map((group, idx) => (
                        <motion.div 
                          key={`${group.date}-${group.area}-${idx}`}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow`}
                        >
                          <div className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 card-${AREA_TO_CLASS[group.area] || 'KCN-Tien-Hai'}`}>
                            <div className="flex items-center gap-3">
                              <div className={`kcn-badge kcn-${AREA_TO_CLASS[group.area] || 'KCN-Tien-Hai'} text-[10px] px-2 py-0.5`}>
                                {group.area}
                              </div>
                              <div className="font-bold text-slate-800 text-base">
                                {new Date(group.date).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                                {group.records.length} ca trực
                              </div>
                              <input 
                                type="checkbox"
                                checked={group.records.every(r => selectedIds.has(r.id))}
                                onChange={() => toggleGroupSelection(group.records)}
                                className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                              />
                            </div>
                          </div>
                          
                          <div className="divide-y divide-slate-100">
                            {group.records.map(log => (
                              <div 
                                key={log.id}
                                className="p-3 hover:bg-slate-50 flex items-center justify-between group transition-colors"
                              >
                                <div className="flex items-center gap-3 flex-1 cursor-pointer" onClick={() => { setSelectedLog(log); setIsDetailModalOpen(true); }}>
                                  <div className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold w-12 text-center">
                                    {log.shift.split(' ')[1]}
                                  </div>
                                  <div className="flex flex-col">
                                    <span className="text-xs font-semibold text-slate-700">{log.shift}</span>
                                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                                      <User className="w-2.5 h-2.5" />
                                      {log.main_duty} {log.sub_duty ? `/ ${log.sub_duty}` : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleEdit(log); }}
                                    className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    title="Sửa"
                                  >
                                    <Edit className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); handleDelete(log.id); }}
                                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    title="Xóa"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); exportToPDF(log); }}
                                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                    title="Tải PDF"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </button>
                                  <input 
                                    type="checkbox"
                                    checked={selectedIds.has(log.id)}
                                    onChange={(e) => { e.stopPropagation(); toggleSelection(log.id); }}
                                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <ElectricShiftManager />
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[2rem] shadow-sm">
              <RefreshCw className="w-16 h-16 text-slate-200 mb-4 animate-spin-slow" />
              <h3 className="text-xl font-bold text-slate-400">Tính năng đang được phát triển</h3>
              <p className="text-slate-400">Vui lòng quay lại sau</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {isDetailModalOpen && selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDetailModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
            >
              <div className="sticky top-0 bg-white/80 backdrop-blur-md p-6 border-b border-slate-100 flex justify-between items-center z-10">
                <h3 className="text-xl font-bold text-slate-800">Chi tiết lịch trực</h3>
                <button 
                  onClick={() => setIsDetailModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <div className="p-8 overflow-y-auto max-h-[calc(90vh-80px)] space-y-8">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-6">
                  <div>
                    <div className="text-3xl font-bold text-slate-900">{selectedLog.area} • {selectedLog.shift}</div>
                    <div className="text-lg text-slate-500 mt-2 flex items-center gap-2">
                      <Calendar className="w-5 h-5" />
                      {new Date(selectedLog.date).toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="text-right text-slate-400 text-xs font-medium">
                    Tạo: {new Date(selectedLog.created).toLocaleString('vi-VN')}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 bg-slate-50 p-6 rounded-3xl">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-100 rounded-xl"><User className="w-5 h-5 text-emerald-600" /></div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Trực chính</div>
                        <div className="font-semibold">{selectedLog.main_duty || '—'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-200 rounded-xl"><User className="w-5 h-5 text-slate-600" /></div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Trực phụ</div>
                        <div className="font-semibold">{selectedLog.sub_duty || '—'}</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-xl"><Zap className="w-5 h-5 text-blue-600" /></div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Điện lực chính</div>
                        <div className="font-semibold">{selectedLog.main_power || '—'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-200 rounded-xl"><Zap className="w-5 h-5 text-slate-600" /></div>
                      <div>
                        <div className="text-xs text-slate-400 uppercase font-bold tracking-wider">Điện lực phụ</div>
                        <div className="font-semibold">{selectedLog.sub_power || '—'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {selectedLog.situations && selectedLog.situations.length > 0 && (
                  <div>
                    <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-emerald-600" />
                      Tình hình trong ca
                    </h4>
                    <div className="border border-slate-100 rounded-2xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="p-3 text-left font-bold text-slate-500 w-24">Giờ</th>
                            <th className="p-3 text-left font-bold text-slate-500">Nội dung</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedLog.situations.map((s, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="p-3 text-emerald-600 font-bold">{s.time}</td>
                              <td className="p-3 text-slate-700">{s.content}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="space-y-8 border-t border-slate-100 pt-8">
                  <div>
                    <h5 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-emerald-600" />
                      1. Lưu ý & tồn tại ca sau
                    </h5>
                    <div className="text-slate-600 bg-slate-50 p-4 rounded-2xl whitespace-pre-wrap">{selectedLog.notes || 'Không có'}</div>
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                      <Package className="w-4 h-4 text-emerald-600" />
                      2. Trang bị, liên lạc, vệ sinh
                    </h5>
                    <div className="text-slate-600 bg-slate-50 p-4 rounded-2xl whitespace-pre-wrap">{selectedLog.equipment || 'Không có'}</div>
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-800 mb-2 flex items-center gap-2">
                      <User className="w-4 h-4 text-emerald-600" />
                      3. Ý kiến lãnh đạo
                    </h5>
                    <div className="text-slate-600 bg-slate-50 p-4 rounded-2xl whitespace-pre-wrap">{selectedLog.opinions || 'Không có'}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                  <button 
                    onClick={() => exportToPDF(selectedLog)}
                    className="bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <Download className="w-5 h-5" /> In PDF
                  </button>
                  <button 
                    onClick={() => handleEdit(selectedLog)}
                    className="bg-amber-500 hover:bg-amber-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <Edit className="w-5 h-5" /> Sửa
                  </button>
                  <button 
                    onClick={() => handleDelete(selectedLog.id)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95"
                  >
                    <Trash2 className="w-5 h-5" /> Xóa
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Form Modal */}
      <AnimatePresence>
        {isFormModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFormModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-[2.5rem] w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
            >
              <div className="sticky top-0 bg-white/80 backdrop-blur-md p-6 border-b border-slate-100 flex justify-between items-center z-10">
                <h3 className="text-xl font-bold text-slate-800">
                  {currentEditId ? '✏️ Chỉnh sửa lịch trực' : '✍️ Tạo lịch trực mới'}
                </h3>
                <button 
                  onClick={() => setIsFormModalOpen(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-8 overflow-y-auto max-h-[calc(90vh-80px)] space-y-8">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Ngày</label>
                    <input 
                      type="date" 
                      required
                      value={formData.date}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">Ca trực</label>
                      <button 
                        type="button"
                        onClick={handleAutoAssign}
                        className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-3 py-2 rounded-xl shadow-sm shadow-emerald-600/20 transition-all active:scale-95 flex items-center gap-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Tự động phân ca
                      </button>
                    </div>
                    <select 
                      value={formData.shift}
                      onChange={(e) => setFormData({ ...formData, shift: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                    >
                      <option value="Ca 1">Ca 1 (06:00 – 14:00)</option>
                      <option value="Ca 2">Ca 2 (14:00 – 22:00)</option>
                      <option value="Ca 3">Ca 3 (22:00 – 06:00)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Trực chính</label>
                    <select 
                      value={formData.main_duty}
                      onChange={(e) => setFormData({ ...formData, main_duty: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                      required
                    >
                      <option value="">-- Chọn người trực chính --</option>
                      {staffList.map(s => (
                        <option key={s.id} value={s.Name}>{s.Name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Trực phụ</label>
                    <select 
                      value={formData.sub_duty}
                      onChange={(e) => setFormData({ ...formData, sub_duty: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                    >
                      <option value="">-- Chọn người trực phụ --</option>
                      {staffList.map(s => (
                        <option key={s.id} value={s.Name}>{s.Name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Điện lực chính</label>
                    <input 
                      placeholder="Họ tên điện lực chính"
                      value={formData.main_power}
                      onChange={(e) => setFormData({ ...formData, main_power: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Điện lực phụ</label>
                    <input 
                      placeholder="Họ tên điện lực phụ"
                      value={formData.sub_power}
                      onChange={(e) => setFormData({ ...formData, sub_power: e.target.value })}
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">1. Lưu ý & tồn tại ca sau</label>
                    <textarea 
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      className="w-full p-5 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none resize-none"
                    ></textarea>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">2. Trang bị, liên lạc, vệ sinh</label>
                    <textarea 
                      rows={3}
                      value={formData.equipment}
                      onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
                      className="w-full p-5 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none resize-none"
                    ></textarea>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">3. Ý kiến lãnh đạo</label>
                    <textarea 
                      rows={3}
                      value={formData.opinions}
                      onChange={(e) => setFormData({ ...formData, opinions: e.target.value })}
                      className="w-full p-5 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none resize-none"
                    ></textarea>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h4 className="font-bold text-slate-800 flex items-center gap-2">
                      <Clock className="w-5 h-5 text-emerald-600" />
                      Tình hình trong ca
                    </h4>
                    <button 
                      type="button" 
                      onClick={addSituationRow}
                      className="text-emerald-600 hover:text-emerald-700 text-sm font-bold flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-xl transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Thêm dòng
                    </button>
                  </div>
                  <div className="border border-slate-100 rounded-2xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="p-3 text-left font-bold text-slate-500 w-32">Giờ</th>
                          <th className="p-3 text-left font-bold text-slate-500">Nội dung</th>
                          <th className="w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {situationRows.map((row, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="p-2">
                              <input 
                                type="time"
                                step="60"
                                value={row.time}
                                onChange={(e) => updateSituationRow(i, 'time', e.target.value)}
                                className="w-full p-2 bg-white border border-slate-200 rounded-xl outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="p-2">
                              <input 
                                type="text"
                                value={row.content}
                                onChange={(e) => updateSituationRow(i, 'content', e.target.value)}
                                className="w-full p-2 bg-white border border-slate-200 rounded-xl outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="p-2 text-center">
                              <button 
                                type="button"
                                onClick={() => removeSituationRow(i)}
                                className="text-red-400 hover:text-red-600 p-1"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-4 pt-6">
                  <button 
                    type="button"
                    onClick={() => setIsFormModalOpen(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 py-5 rounded-3xl font-bold transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-5 rounded-3xl font-bold shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
                  >
                    {currentEditId ? 'Lưu thay đổi' : 'Lưu lịch trực'}
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
