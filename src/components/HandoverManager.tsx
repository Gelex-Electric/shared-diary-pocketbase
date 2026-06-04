import React, { useState, useEffect, useCallback } from 'react';
import { pb, AREAS, AREA_TO_CLASS, ID_TO_AREA } from '../lib/pocketbase';
import { Handover, Situation, ElectricShift } from '../types';
import {
  Plus, Trash2, Edit2, X, CheckCircle2, Search,
  Calendar, Clock, User, Users, Zap, Download, ChevronDown,
  ChevronRight, RefreshCw, ClipboardList, Package,
  MessageSquare, FileText, Activity, CheckSquare, Square,
  AlertTriangle, ZapOff, ClipboardCheck, ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import pdfMake from 'pdfmake/build/pdfmake';

const timesUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Regular.ttf';
const timesBdUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Bold.ttf';
const timesBiUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-BoldItalic.ttf';
const timesIUrl = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/tinos/Tinos-Italic.ttf';

let fontsLoaded = false;

const loadFontsToVfs = async () => {
  if (fontsLoaded) return;
  const entries: [string, string][] = [
    ['times.ttf', timesUrl],
    ['timesbd.ttf', timesBdUrl],
    ['timesbi.ttf', timesBiUrl],
    ['timesi.ttf', timesIUrl],
  ];
  await Promise.all(entries.map(async ([name, url]) => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    (pdfMake as any).virtualfs.writeFileSync(name, new Uint8Array(buf));
  }));
  pdfMake.fonts = {
    Times: { normal: 'times.ttf', bold: 'timesbd.ttf', italics: 'timesi.ttf', bolditalics: 'timesbi.ttf' }
  };
  fontsLoaded = true;
};

const TYPE_SHIFT_CONFIG: Record<string, {
  icon: React.ElementType;
  color: string;
  bg: string;
  border: string;
  label: string;
}> = {
  'Bình thường':        { icon: ShieldCheck,     color: 'text-emerald-600', bg: 'bg-emerald-50',  border: 'border-emerald-200', label: 'Bình thường' },
  'Sự cố':              { icon: AlertTriangle,    color: 'text-red-600',     bg: 'bg-red-50',      border: 'border-red-200',     label: 'Sự cố' },
  'Đóng cắt':           { icon: ZapOff,           color: 'text-amber-600',   bg: 'bg-amber-50',    border: 'border-amber-200',   label: 'Đóng cắt' },
  'Kiểm tra định kỳ':   { icon: ClipboardCheck,   color: 'text-blue-600',    bg: 'bg-blue-50',     border: 'border-blue-200',    label: 'Kiểm tra định kỳ' },
};

const TYPE_SHIFT_OPTIONS = Object.keys(TYPE_SHIFT_CONFIG);

export default function HandoverManager() {
  const [logs, setLogs] = useState<Handover[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState({ 
    month: (new Date().getMonth() + 1).toString().padStart(2, '0'),
    area: '' 
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const shiftBadgeClass = (shift: string) => {
    if (shift === 'Ca 1') return 'vl-badge-primary rounded px-2 py-0.5';
    if (shift === 'Ca 2') return 'vl-badge-warning rounded px-2 py-0.5';
    if (shift === 'Ca 3') return 'bg-purple-100 text-purple-700 rounded px-2 py-0.5';
    return 'vl-badge-primary rounded px-2 py-0.5';
  };

  const expandAll = () => setExpandedGroups(new Set(groupedLogs.map(g => g.id)));
  const collapseAll = () => setExpandedGroups(new Set());
  
  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedLog, setSelectedLog] = useState<Handover | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [formData, setFormData] = useState(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    return {
      startDate: todayStr,
      startTime: '06:00',
      endDate: todayStr,
      endTime: '14:00',
      area: AREAS[0],
      shift: 'Ca 1',
      type_shift: ['Bình thường'] as string[],
      main_duty: '',
      sub_duty: '',
      main_power: '',
      sub_power: '',
      notes: '',
      equipment: '',
      opinions: '',
    };
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
        const currentYear = new Date().getFullYear();
        const startOfMonth = `${currentYear}-${filter.month}-01 00:00:00`;
        const nextMonth = parseInt(filter.month) + 1;
        const endYear = nextMonth > 12 ? currentYear + 1 : currentYear;
        const endMonth = nextMonth > 12 ? '01' : nextMonth.toString().padStart(2, '0');
        const endOfMonth = `${endYear}-${endMonth}-01 00:00:00`;
        filterParts.push(`startdate >= '${startOfMonth}' && startdate < '${endOfMonth}'`);
      }

      const result = await pb.collection('handovers').getFullList<Handover>({
        filter: filterParts.join(' && '),
        sort: '-startdate',
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

  const groupedLogs = React.useMemo(() => {
    return logs.reduce((acc: { id: string, date: string, area: string, records: Handover[] }[], log) => {
      // Treat stored date as "wall clock" time by using UTC methods
      const dateObj = new Date(log.startdate.includes('Z') ? log.startdate : log.startdate + 'Z');
      const logDate = `${dateObj.getUTCFullYear()}-${(dateObj.getUTCMonth() + 1).toString().padStart(2, '0')}-${dateObj.getUTCDate().toString().padStart(2, '0')}`;
      
      const groupId = `${logDate}-${log.area}`;
      const existing = acc.find(g => g.id === groupId);
      
      if (existing) {
        existing.records.push(log);
        // Sort by shift name descending (Ca 3, Ca 2, Ca 1)
        existing.records.sort((a, b) => {
          // Extract shift numbers if possible for numeric comparison
          const getShiftNum = (s: string) => {
            const match = s.match(/\d+/);
            return match ? parseInt(match[0]) : 0;
          };
          const numA = getShiftNum(a.shift);
          const numB = getShiftNum(b.shift);
          
          if (numA !== numB) return numB - numA;
          
          // Fallback to time if shifts are same
          const timeA = new Date(a.startdate.includes('Z') ? a.startdate : a.startdate + 'Z').getTime();
          const timeB = new Date(b.startdate.includes('Z') ? b.startdate : b.startdate + 'Z').getTime();
          return timeB - timeA;
        });
      } else {
        acc.push({ id: groupId, date: logDate, area: log.area, records: [log] });
      }
      return acc;
    }, []);
  }, [logs]);

  // Handlers
  const startAddLog = () => {
    setIsModalOpen(true);
    setEditingLogId(null);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
    
    setFormData({
      startDate: todayStr,
      startTime: '06:00',
      endDate: todayStr,
      endTime: '14:00',
      area: effectiveAreas[0] || AREAS[0],
      shift: 'Ca 1',
      type_shift: ['Bình thường'] as string[],
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
    
    // Safety parsing for startdate and enddate
    const parseDateTime = (dtStr: string) => {
      if (!dtStr) return { date: new Date().toISOString().split('T')[0], time: '00:00' };
      const parts = dtStr.includes(' ') ? dtStr.split(' ') : dtStr.split('T');
      const date = parts[0] || new Date().toISOString().split('T')[0];
      const time = (parts[1] || '00:00').substring(0, 5);
      return { date, time };
    };

    const start = parseDateTime(log.startdate);
    const end = parseDateTime(log.enddate);
    
    setFormData({
      startDate: start.date,
      startTime: start.time,
      endDate: end.date,
      endTime: end.time,
      area: log.area,
      shift: log.shift,
      type_shift: Array.isArray(log.type_shift)
        ? (log.type_shift.length > 0 ? log.type_shift : ['Bình thường'])
        : (log.type_shift ? [log.type_shift as unknown as string] : ['Bình thường']),
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
    if (isSaving) return;
    setIsSaving(true);
    try {
      // Save as "wall clock" time strings to avoid timezone shifts in filtering
      const startdate = `${formData.startDate} ${formData.startTime}:00`;
      const enddate = `${formData.endDate} ${formData.endTime}:00`;

      const data = {
        startdate,
        enddate,
        area: formData.area,
        shift: formData.shift,
        type_shift: formData.type_shift.length > 0 ? formData.type_shift : ['Bình thường'],
        main_duty: formData.main_duty,
        sub_duty: formData.sub_duty,
        main_power: formData.main_power,
        sub_power: formData.sub_power,
        notes: formData.notes,
        equipment: formData.equipment,
        opinions: formData.opinions,
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
      alert('Lỗi khi lưu lịch trực. Vui lòng thử lại.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Bạn có chắc muốn xóa lịch trực này?')) return;
    try {
      await pb.collection('handovers').delete(id);
      loadLogs();
    } catch (err) {
      console.error('Delete log error:', err);
    }
  };

  const handleAutoAssign = () => {
    if (staffList.length < 6) {
      alert('Cần ít nhất 6 nhân sự trực để tự động xoay ca!');
      return;
    }
    
    const date = new Date(formData.startDate);
    if (isNaN(date.getTime())) return;

    const epoch = new Date(2026, 0, 1);
    const diffTime = date.getTime() - epoch.getTime();
    const dayIndex = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    const monthOffset = date.getMonth() * 2;

    // Sắp xếp trước để lấy độ dài thực tế làm modulo
    // → 6 người: % 6 (giữ nguyên hành vi cũ), 7+ người: tự thích nghi
    const rotatedStaff = [...staffList].sort((a, b) => a.IDnum - b.IDnum);
    const rotation = Math.abs(dayIndex + monthOffset) % rotatedStaff.length;

    for (let i = 0; i < rotation; i++) {
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

  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr.includes('Z') ? dateStr : dateStr + 'Z');
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const minutes = date.getUTCMinutes().toString().padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch (e) {
      return '--:--';
    }
  };

  const formatFullDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr.includes('Z') ? dateStr : dateStr + 'Z');
      const time = `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
      const day = date.getUTCDate().toString().padStart(2, '0');
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const year = date.getUTCFullYear();
      return `${time} ngày ${day}/${month}/${year}`;
    } catch (e) {
      return '---';
    }
  };

  // PDF Export Logic
  const getLogPDFContent = (log: Handover) => {
    const start = new Date(log.startdate.includes('Z') ? log.startdate : log.startdate + 'Z');
    const end = new Date(log.enddate.includes('Z') ? log.enddate : log.enddate + 'Z');
    
    const formatDateTime = (date: Date) => {
      const time = `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
      const day = date.getUTCDate().toString().padStart(2, '0');
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const year = date.getUTCFullYear();
      return `${time} ngày ${day}/${month}/${year}`;
    };

    const caTime = `Từ ${formatDateTime(start)} đến ${formatDateTime(end)}`;
    const giaoCaStr = formatDateTime(end);

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
    setIsExportingPdf(true);
    try {
      await loadFontsToVfs();
      const docDefinition: any = {
        pageSize: 'A4',
        pageMargins: [35, 30, 35, 30],
        defaultStyle: { font: 'Times', fontSize: 12, lineHeight: 1.4 },
        content: getLogPDFContent(log),
        styles: {
          header: { fontSize: 13, bold: true },
          subheader: { fontSize: 12, bold: true },
          boldSection: { bold: true, fontSize: 12 }
        }
      };
      pdfMake.createPdf(docDefinition).download(`SoTruc_${log.area}_${log.shift}_${log.startdate.split(' ')[0]}.pdf`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const exportMultipleToPDF = async () => {
    if (selectedIds.size === 0) return;
    setIsExportingPdf(true);
    try {
      await loadFontsToVfs();
      const selectedLogs = logs
        .filter(log => selectedIds.has(log.id))
        .sort((a, b) => new Date(a.startdate).getTime() - new Date(b.startdate).getTime());
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
        defaultStyle: { font: 'Times', fontSize: 12, lineHeight: 1.4 },
        content: combinedContent,
        styles: {
          header: { fontSize: 13, bold: true },
          subheader: { fontSize: 12, bold: true },
          boldSection: { bold: true, fontSize: 12 }
        }
      };
      pdfMake.createPdf(docDefinition).download(`SoTruc_TongHop_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.pdf`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExportingPdf(false);
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

  const selectAllInMonth = () => {
    const allIds = new Set(logs.map(log => log.id));
    setSelectedIds(allIds);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const uniqueDaysCount = React.useMemo(() => {
    return new Set(logs.map(log => {
      const dateObj = new Date(log.startdate.includes('Z') ? log.startdate : log.startdate + 'Z');
      return `${dateObj.getUTCFullYear()}-${(dateObj.getUTCMonth() + 1).toString().padStart(2, '0')}-${dateObj.getUTCDate().toString().padStart(2, '0')}`;
    })).size;
  }, [logs]);

  const typeShiftCounts = React.useMemo(() => {
    const counts: Record<string, number> = { 'Bình thường': 0, 'Sự cố': 0, 'Đóng cắt': 0, 'Kiểm tra định kỳ': 0 };
    logs.forEach(log => {
      const types = Array.isArray(log.type_shift) ? log.type_shift : [log.type_shift || 'Bình thường'];
      types.forEach(t => { if (t in counts) counts[t]++; });
    });
    return counts;
  }, [logs]);

  return (
    <div className="space-y-8 relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-2xl font-bold text-slate-800">Sổ nhật ký điện tử</h2>
            {!isLoading && logs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2.5 py-1 rounded shadow-xs">
                  <Calendar className="w-3.5 h-3.5 text-[#5a8dee]" />
                  T{filter.month}: {uniqueDaysCount} ngày · {logs.length} ca
                </span>
                {([
                  { key: 'Bình thường', dot: 'bg-emerald-500', label: 'BT' },
                  { key: 'Sự cố',       dot: 'bg-red-500',     label: 'SC' },
                  { key: 'Đóng cắt',   dot: 'bg-amber-500',   label: 'ĐC' },
                  { key: 'Kiểm tra định kỳ', dot: 'bg-blue-500', label: 'KTĐK' },
                ] as const).filter(({ key }) => typeShiftCounts[key] > 0).map(({ key, dot, label }) => (
                  <span key={key} className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 bg-white border border-slate-200 px-2 py-1 rounded shadow-xs">
                    <span className={`w-2 h-2 rounded-full ${dot}`} />
                    {label}: {typeShiftCounts[key]}
                  </span>
                ))}
              </div>
            )}
          </div>
          <p className="text-slate-500 text-sm mt-1">Quản lý lịch trực và tình hình vận hành</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={filter.area}
            onChange={(e) => setFilter({ ...filter, area: e.target.value })}
            className="bg-white border border-slate-200 rounded px-4 py-2.5 text-[13px] font-medium focus:ring-2 focus:ring-[#5a8dee] outline-none transition-all"
          >
            <option value="">Tất cả khu vực</option>
            {effectiveAreas.map(area => (
              <option key={area} value={area}>{area}</option>
            ))}
          </select>
          <select
            value={filter.month}
            onChange={(e) => setFilter({ ...filter, month: e.target.value })}
            className="bg-white border border-slate-200 rounded px-4 py-2.5 text-[13px] font-medium focus:ring-2 focus:ring-[#5a8dee] outline-none transition-all"
          >
            {Array.from({ length: 12 }, (_, i) => {
              const m = (i + 1).toString().padStart(2, '0');
              return <option key={m} value={m}>Tháng {i + 1}</option>;
            })}
          </select>
          <button
            onClick={startAddLog}
            className="vl-btn vl-btn-primary flex-1 md:flex-none px-6 py-2.5 font-medium text-[13px] flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Tạo lịch trực
          </button>
          <button
            disabled={selectedIds.size === 0 || isExportingPdf}
            onClick={exportMultipleToPDF}
            className={`flex-1 md:flex-none px-6 py-2.5 font-medium text-[13px] flex items-center justify-center gap-2 transition-all ${selectedIds.size > 0 && !isExportingPdf ? 'vl-btn vl-btn-secondary shadow-lg shadow-slate-700/20' : 'bg-slate-100 text-slate-400 rounded cursor-not-allowed'}`}
          >
            {isExportingPdf ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Download className="w-5 h-5" />
            )}
            {isExportingPdf ? 'Đang xuất...' : `PDF${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
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
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
              >
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20">
                      <ClipboardList className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">{editingLogId ? 'Sửa lịch trực' : 'Tạo lịch trực mới'}</h3>
                      <p className="text-slate-500 text-xs mt-0.5">Vui lòng điền đầy đủ thông tin vận hành trong ca</p>
                    </div>
                  </div>
                  <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded transition-colors">
                    <X className="w-6 h-6 text-slate-400" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Khu vực</label>
                      <select value={formData.area} onChange={(e) => setFormData({ ...formData, area: e.target.value })} className="w-full p-3 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee]">
                        {effectiveAreas.map(area => <option key={area} value={area}>{area}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Ca trực</label>
                      <select 
                        value={formData.shift} 
                        onChange={(e) => {
                          const newShift = e.target.value;
                          let newStartTime = formData.startTime;
                          let newEndTime = formData.endTime;
                          let newEndDate = formData.startDate;

                          const getNextDay = (dateStr: string) => {
                            const [year, month, day] = dateStr.split('-').map(Number);
                            const date = new Date(year, month - 1, day);
                            date.setDate(date.getDate() + 1);
                            return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
                          };

                          if (newShift === 'Ca 1') {
                            newStartTime = '06:00';
                            newEndTime = '14:00';
                            newEndDate = formData.startDate;
                          } else if (newShift === 'Ca 2') {
                            newStartTime = '14:00';
                            newEndTime = '22:00';
                            newEndDate = formData.startDate;
                          } else if (newShift === 'Ca 3') {
                            newStartTime = '22:00';
                            newEndTime = '06:00';
                            newEndDate = getNextDay(formData.startDate);
                          }

                          setFormData({ 
                            ...formData, 
                            shift: newShift,
                            startTime: newStartTime,
                            endTime: newEndTime,
                            endDate: newEndDate
                          });
                        }} 
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee]"
                      >
                        <option value="Ca 1">Ca 1 (06:00 - 14:00)</option>
                        <option value="Ca 2">Ca 2 (14:00 - 22:00)</option>
                        <option value="Ca 3">Ca 3 (22:00 - 06:00)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1 block">Thời gian bắt đầu</label>
                      <div className="grid grid-cols-2 gap-4">
                        <input 
                          type="date" 
                          value={formData.startDate} 
                          onChange={(e) => {
                            const newStartDate = e.target.value;
                            let newEndDate = newStartDate;
                            if (formData.shift === 'Ca 3') {
                              const [year, month, day] = newStartDate.split('-').map(Number);
                              const date = new Date(year, month - 1, day);
                              date.setDate(date.getDate() + 1);
                              newEndDate = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
                            }
                            setFormData({ ...formData, startDate: newStartDate, endDate: newEndDate });
                          }} 
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee]"
                        />
                        <input 
                          type="time" 
                          value={formData.startTime} 
                          onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} 
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee]"
                        />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1 block">Thời gian kết thúc</label>
                      <div className="grid grid-cols-2 gap-4">
                        <input 
                          type="date" 
                          value={formData.endDate} 
                          onChange={(e) => setFormData({ ...formData, endDate: e.target.value })} 
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee]"
                        />
                        <input 
                          type="time" 
                          value={formData.endTime} 
                          onChange={(e) => setFormData({ ...formData, endTime: e.target.value })} 
                          className="w-full p-3 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Loại ca – multi-select */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 ml-1">
                      <label className="text-xs font-bold text-slate-400 uppercase">Loại ca trực</label>
                      <span className="text-[10px] text-slate-400 font-medium">(có thể chọn nhiều)</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {TYPE_SHIFT_OPTIONS.map((key) => {
                        const cfg = TYPE_SHIFT_CONFIG[key];
                        const Icon = cfg.icon;
                        const isSelected = formData.type_shift.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              const cur = formData.type_shift;
                              const next = isSelected
                                ? cur.filter(k => k !== key)
                                : [...cur, key];
                              setFormData({ ...formData, type_shift: next.length > 0 ? next : ['Bình thường'] });
                            }}
                            className={`relative flex flex-col items-center gap-2 p-3.5 rounded-2xl border-2 transition-all select-none ${
                              isSelected
                                ? `${cfg.bg} ${cfg.border} ${cfg.color} shadow-sm`
                                : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {isSelected && (
                              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-current opacity-70" />
                            )}
                            <Icon className="w-5 h-5" />
                            <span className="text-[11px] font-bold leading-tight text-center">{key}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 space-y-6">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5 text-blue-600" /> Nhân sự trực</h4>
                      <button onClick={handleAutoAssign} className="text-xs font-bold text-blue-600 bg-white border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">Tự động phân ca</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trực đội QLVH</div>
                        <select value={formData.main_duty} onChange={(e) => setFormData({ ...formData, main_duty: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee]">
                          <option value="">Chọn trực chính</option>
                          {staffList.map(s => <option key={s.id} value={s.Name}>{s.Name}</option>)}
                        </select>
                        <select value={formData.sub_duty} onChange={(e) => setFormData({ ...formData, sub_duty: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee]">
                          <option value="">Chọn trực phụ</option>
                          {staffList.map(s => <option key={s.id} value={s.Name}>{s.Name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-3">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Trực điều độ điện lực</div>
                        <input type="text" placeholder="Trực chính điện lực" value={formData.main_power} onChange={(e) => setFormData({ ...formData, main_power: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee]" />
                        <input type="text" placeholder="Trực phụ điện lực" value={formData.sub_power} onChange={(e) => setFormData({ ...formData, sub_power: e.target.value })} className="w-full p-3 bg-white border border-slate-200 rounded text-sm outline-none focus:ring-2 focus:ring-[#5a8dee]" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600" /> Tình hình vận hành trong ca</h4>
                      <button 
                        onClick={() => setSituationRows([...situationRows, { time: '', content: '' }])}
                        className="text-xs font-bold text-blue-600 flex items-center gap-1 hover:underline"
                      >
                        <Plus className="w-4 h-4" /> Thêm dòng
                      </button>
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
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
                                <textarea
                                  rows={2}
                                  placeholder="Nội dung công việc..."
                                  value={row.content}
                                  onChange={(e) => {
                                    const newRows = [...situationRows];
                                    newRows[idx].content = e.target.value;
                                    setSituationRows(newRows);
                                  }}
                                  className="w-full p-2 bg-transparent outline-none focus:bg-slate-50 rounded-lg resize-none text-sm leading-relaxed"
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
                      <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] min-h-[100px]" placeholder="Nhập các lưu ý cho ca sau..." />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Trang bị vận hành, thông tin liên lạc, vệ sinh công nghiệp</label>
                      <textarea value={formData.equipment} onChange={(e) => setFormData({ ...formData, equipment: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] min-h-[100px]" placeholder="Tình trạng trang thiết bị..." />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase ml-1">Ý kiến lãnh đạo đơn vị</label>
                      <textarea value={formData.opinions} onChange={(e) => setFormData({ ...formData, opinions: e.target.value })} className="w-full p-4 bg-slate-50 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-[#5a8dee] min-h-[100px]" placeholder="Ý kiến chỉ đạo..." />
                    </div>
                  </div>
                </div>

                <div className="p-8 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
                  <button 
                    onClick={closeModal} 
                    disabled={isSaving}
                    className="vl-btn vl-btn-secondary px-8 py-3 font-bold transition-all disabled:opacity-50"
                  >
                    Hủy bỏ
                  </button>
                  <button 
                    onClick={saveLog} 
                    disabled={isSaving}
                    className="vl-btn vl-btn-primary px-8 py-3 font-bold transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        Đang lưu...
                      </>
                    ) : (
                      'Lưu lịch trực'
                    )}
                  </button>
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
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-2xl overflow-hidden flex flex-col"
              >
                <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20">
                      <FileText className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="text-xl font-bold text-slate-800">Chi tiết lịch trực</h3>
                        {(Array.isArray(selectedLog.type_shift) ? selectedLog.type_shift : [selectedLog.type_shift || 'Bình thường']).map(ts => {
                          const cfg = TYPE_SHIFT_CONFIG[ts] ?? TYPE_SHIFT_CONFIG['Bình thường'];
                          const Icon = cfg.icon;
                          return (
                            <span key={ts} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                              <Icon className="w-3.5 h-3.5" />
                              {ts}
                            </span>
                          );
                        })}
                      </div>
                      <p className="text-slate-500 text-xs">
                        {formatFullDateTime(selectedLog.startdate)} — {formatFullDateTime(selectedLog.enddate)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => exportToPDF(selectedLog)} className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-all" title="Tải PDF"><Download className="w-6 h-6" /></button>
                    <button onClick={closeModal} className="p-2 hover:bg-slate-200 rounded transition-colors">
                      <X className="w-6 h-6 text-slate-400" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                  {/* Row 1: Thời gian giao nhận ca */}
                  <div className="bg-blue-50/50 p-5 rounded-lg border border-blue-100">
                    <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2 mb-4"><Clock className="w-4 h-4" /> Thời gian giao nhận ca</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-blue-500 uppercase">Bắt đầu (Nhận ca)</div>
                        <p className="text-sm font-bold text-slate-700">{formatFullDateTime(selectedLog.startdate)}</p>
                      </div>
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-blue-500 uppercase">Kết thúc (Giao ca)</div>
                        <p className="text-sm font-bold text-slate-700">{formatFullDateTime(selectedLog.enddate)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Nhân viên vận hành */}
                  <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4"><Users className="w-4 h-4" /> Nhân viên vận hành các đơn vị</h4>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Trực đội QLVH</div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 w-10">Chính</span>
                            <span className="px-2.5 py-1 vl-badge-primary rounded text-xs font-bold">{selectedLog.main_duty || '—'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 w-10">Phụ</span>
                            <span className="px-2.5 py-1 vl-badge-primary rounded text-xs font-semibold">{selectedLog.sub_duty || '—'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold text-slate-400 uppercase">Trực điều độ điện lực</div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 w-10">Chính</span>
                            <span className="px-2.5 py-1 vl-badge-primary rounded text-xs font-bold">{selectedLog.main_power || '—'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 w-10">Phụ</span>
                            <span className="px-2.5 py-1 vl-badge-primary rounded text-xs font-semibold">{selectedLog.sub_power || '—'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Operation situation */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2"><Activity className="w-4 h-4 text-blue-600" /> I. Tình hình vận hành trong ca</h4>
                    <div className="border border-slate-100 rounded-lg overflow-hidden bg-slate-50/50">
                      <table className="vl-table w-full text-sm border-collapse">
                        <thead className="bg-slate-100 border-b border-slate-200">
                          <tr>
                            <th className="px-6 py-3.5 text-left font-bold text-slate-500 w-32">Thời gian</th>
                            <th className="px-6 py-3.5 text-left font-bold text-slate-500">Nội dung</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedLog.situations && selectedLog.situations.length > 0 ? (
                            selectedLog.situations.map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-50">
                                <td className="px-6 py-4 font-semibold text-slate-600">{row.time}</td>
                                <td className="px-6 py-4 text-slate-800 font-medium">{row.content}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={2} className="px-6 py-6 text-center text-slate-400 italic">Không có ghi chép tình hình vận hành</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Row 3: Notes & Equipment & Leader comments */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 space-y-2">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">1. Những lưu ý ca sau giải quyết</h4>
                      <p className="text-sm text-slate-750 font-medium whitespace-pre-wrap">{selectedLog.notes || 'Không có'}</p>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 space-y-2">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">2. Trang bị vận hành, vệ sinh</h4>
                      <p className="text-sm text-slate-750 font-medium whitespace-pre-wrap">{selectedLog.equipment || 'Không có'}</p>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 space-y-2">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">3. Ý kiến lãnh đạo đơn vị</h4>
                      <p className="text-sm text-slate-750 font-medium whitespace-pre-wrap">{selectedLog.opinions || 'Không có'}</p>
                    </div>
                  </div>
                </div>

                <div className="p-8 border-t border-slate-100 flex justify-end bg-slate-50/50">
                  <button onClick={closeModal} className="vl-btn vl-btn-secondary px-8 py-3 font-bold transition-all shadow-lg active:scale-95">Đóng cửa sổ</button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Sub-header strip: expand/collapse + select/deselect + count */}
        {!isLoading && logs.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-1">
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-xs"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                Mở tất cả
              </button>
              <button
                onClick={collapseAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-xs"
              >
                <ChevronRight className="w-3.5 h-3.5" />
                Thu tất cả
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllInMonth}
                disabled={logs.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-xs disabled:opacity-50"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Chọn hết
              </button>
              <button
                onClick={deselectAll}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-all shadow-xs disabled:opacity-50"
              >
                <Square className="w-3.5 h-3.5" />
                Bỏ chọn {selectedIds.size > 0 && `(${selectedIds.size})`}
              </button>
            </div>
          </div>
        )}

        {/* Data List grouped by Date & Industrial park */}
        <div className="space-y-6">
          {isLoading ? (
            <div className="vl-card flex flex-col items-center justify-center p-20 text-slate-400">
              <RefreshCw className="w-10 h-10 animate-spin mb-4" />
              <p className="text-sm">Đang tải nhật ký lịch trực...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="vl-card flex flex-col items-center justify-center p-20 text-slate-400">
              <Calendar className="w-16 h-16 opacity-20 mb-4" />
              <p className="text-sm font-semibold">Chưa có lịch trực nào được ghi nhận cho bộ lọc hiện tại</p>
            </div>
          ) : (
            groupedLogs.map((group) => {
              const isExpanded = expandedGroups.has(group.id);
              const groupSelected = group.records.every(r => selectedIds.has(r.id));
              
              const formatGroupHeaderDate = (dateStr: string) => {
                const parts = dateStr.split('-');
                return `Ngày ${parts[2]}/${parts[1]}/${parts[0]}`;
              };

              return (
                <div key={group.id} className="vl-card overflow-hidden">
                  {/* Group Header — toàn bộ header có thể click để mở/thu */}
                  <div
                    className="p-6 flex items-center justify-between bg-slate-50/60 border-b border-slate-100 flex-wrap gap-4 cursor-pointer select-none"
                    onClick={() => toggleGroupExpand(group.id)}
                  >
                    <div className="flex items-center gap-4">
                      {/* Mũi tên ở đầu */}
                      <motion.div
                        animate={{ rotate: isExpanded ? 90 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-slate-400 shrink-0"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </motion.div>
                      <div className="p-2 bg-white rounded shadow-xs">
                        <Calendar className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-[15px]">{formatGroupHeaderDate(group.date)}</h3>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-600 rounded-full font-bold text-[10px] uppercase tracking-wider mt-1">{group.area}</span>
                      </div>
                    </div>
                    {/* Checkbox ở cuối — stopPropagation để không trigger toggle card */}
                    <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                      <span className="text-xs font-bold text-slate-400 uppercase bg-white border border-slate-100 px-3 py-1.5 rounded-lg">{group.records.length} ca trực</span>
                      <input
                        type="checkbox"
                        checked={groupSelected}
                        onChange={() => toggleGroupSelection(group.records)}
                        className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-[#5a8dee]"
                      />
                    </div>
                  </div>

                  {/* Group Rows */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden bg-white divide-y divide-slate-100"
                      >
                        {group.records.map((log) => {
                          const isSelected = selectedIds.has(log.id);

                          return (
                            <div key={log.id} className={`p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:bg-slate-50/40 transition-colors ${isSelected ? 'bg-blue-50/10' : ''}`}>
                              <div className="flex items-start gap-4">
                                <input 
                                  type="checkbox" 
                                  checked={isSelected}
                                  onChange={() => toggleSelection(log.id)}
                                  className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-1"
                                />
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-xs font-extrabold ${shiftBadgeClass(log.shift)}`}>{log.shift}</span>
                                    {(Array.isArray(log.type_shift) ? log.type_shift : [log.type_shift || 'Bình thường']).map(ts => {
                                      const cfg = TYPE_SHIFT_CONFIG[ts] ?? TYPE_SHIFT_CONFIG['Bình thường'];
                                      const Icon = cfg.icon;
                                      return (
                                        <span key={ts} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                                          <Icon className="w-3.5 h-3.5" />
                                          {ts}
                                        </span>
                                      );
                                    })}
                                    <span className="text-xs text-slate-400 font-medium">{formatTime(log.startdate)} — {formatTime(log.enddate)}</span>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                    <div className="flex items-center gap-2 text-slate-600">
                                      <Users className="w-4 h-4 text-slate-400" />
                                      <span>Tổ QLVH: <strong className="text-slate-700">{log.main_duty || '—'}</strong> (Chính) / <span className="text-slate-500">{log.sub_duty || '—'}</span> (Phụ)</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-slate-600">
                                      <Zap className="w-4 h-4 text-slate-400" />
                                      <span>Điều độ: <strong className="text-slate-700">{log.main_power || '—'}</strong> (Chính) / <span className="text-slate-500">{log.sub_power || '—'}</span> (Phụ)</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 self-end md:self-auto">
                                <button
                                  onClick={() => openDetail(log)}
                                  className="px-4 py-2 hover:bg-slate-100 rounded font-bold text-xs text-slate-600 border border-slate-200 transition-all shadow-xs"
                                >
                                  Chi tiết
                                </button>
                                <button
                                  onClick={() => startEditLog(log)}
                                  className="p-2 hover:bg-slate-100 hover:text-blue-600 text-slate-400 rounded border border-slate-100 transition-all shadow-xs"
                                  title="Chỉnh sửa"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(log.id)}
                                  className="p-2 hover:bg-slate-100 hover:text-red-500 text-slate-400 rounded border border-slate-100 transition-all shadow-xs"
                                  title="Xóa bỏ"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
