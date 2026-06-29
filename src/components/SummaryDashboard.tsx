import React, { useState, useMemo, useEffect, useRef } from 'react';
import { toast as notify } from '../lib/toast';
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  Legend,
  LabelList
} from 'recharts';
import { 
  Zap, 
  DollarSign, 
  CheckCircle2,
  XCircle,
  Search,
  TrendingUp, 
  Building2, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  HelpCircle
} from 'lucide-react';
import { pb } from '../lib/pocketbase';
import { Select } from './ui/Select';
import { MonthPicker } from './ui/DateTimePickers';
import { setLocalNotification, clearLocalNotification } from './ui/NotificationBell';

// Bộ nhớ đệm module-level: CSV chỉ fetch một lần duy nhất trong suốt phiên làm việc.
// Giá trị tồn tại kể cả khi SummaryDashboard unmount/remount (chuyển tab).
let _csvCache: string | null = null;
let _csvPromise: Promise<string> | null = null;

// Tải CSV với dedup: nhiều lần mount cùng dùng chung 1 request đang chạy.
// KHÔNG huỷ fetch giữa chừng — luôn để hoàn tất và điền cache.
function loadCsv(): Promise<string> {
  if (_csvCache !== null) return Promise.resolve(_csvCache);
  if (_csvPromise) return _csvPromise;

  _csvPromise = fetch('/datahdKH.csv')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(text => {
      _csvCache = text.replace(/^﻿/, ''); // strip UTF-8 BOM nếu có
      return _csvCache;
    })
    .catch(err => {
      _csvPromise = null; // Cho phép thử lại ở lần mount sau nếu lỗi
      throw err;
    });

  return _csvPromise;
}

// Interface matching each customer record in monthly sheet
interface BillRecord {
  maKH: string;
  tenKH: string;
  ngayXuat: string;
  ngayChotChiSo?: string;
  chartDate: string;   // ngayChotChiSo nếu có, fallback ngayXuat — dùng cho tất cả biểu đồ
  ngayThanhToan: string;
  ky: string;
  sanLuong: number;
  doanhThu: number;
  sauThue: number;
  thangNam: string; // e.g. "05/2026" — lấy từ chartDate
  daThanhToan: boolean;
  diaChi: string; // e.g., "KCNTH"
}

interface CustomerSummary {
  id: string;
  maKH: string;
  tenKH: string;
  thangNam: string;
  totalSanLuong: number;
  totalDoanhThu: number;
  totalSauThue: number;
  isPaid: boolean;
  paymentDates: string[];
  readingDates: string[];
  bills: BillRecord[];
  latestReadingDate: string;
  latestPaymentDate: string;
}

// Simple robust CSV row parser that respects quotes
const parseCSVRow = (row: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(val => val.trim().replace(/^"|"$/g, '').trim());
};

// Year-Month chronological sorting helper
const sortMonths = (months: string[]): string[] => {
  return [...months].sort((a, b) => {
    const [mA, yA] = a.split('/').map(Number);
    const [mB, yB] = b.split('/').map(Number);
    if (!yA || !yB) return 0;
    if (yA !== yB) return yA - yB;
    return mA - mB;
  });
};

// Formats
const formatVND = (num: number) => {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
};

const formatKWh = (num: number) => {
  return new Intl.NumberFormat('vi-VN').format(num) + ' kWh';
};

// Label formatter for chart tops — shows ###.### (vi-VN thousands separator), hides 0
const formatChartLabel = (value: any) => {
  const num = Number(value);
  if (!num || num === 0) return '';
  return new Intl.NumberFormat('vi-VN').format(num);
};

const parseDateString = (dateStr?: string): number => {
  if (!dateStr || dateStr.trim() === '') return 0;
  const parts = dateStr.trim().split('/');
  if (parts.length < 3) return 0;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  return new Date(year, month, day).getTime();
};

const ACCOUNT_MAP: Record<string, string> = {
  'all':   'Tất cả tài khoản (KCN)',
  'KCNTH': 'KCN Tiền Hải (KCNTH)',
  'KCNPĐ': 'KCN Phong Điền (KCNPĐ)',
  'KCNTTI':'KCN Thuận Thành I (KCNTTI)',
  'KCNYM': 'KCN Yên Mỹ (KCNYM)',
  'KCN03': 'KCN Số 3 (KCN03)'
};

export default function SummaryDashboard() {
  // Tải datahdKH.csv từ public/ — dùng cache module-level, không huỷ fetch khi chuyển tab
  const [csvContent, setCsvContent] = useState<string>(_csvCache ?? '');
  useEffect(() => {
    if (_csvCache !== null) return; // Đã có cache → hiển thị ngay, không fetch lại

    let mounted = true;
    loadCsv()
      .then(text => { if (mounted) setCsvContent(text); })
      .catch(err => console.error('Không tải được datahdKH.csv:', err));

    // Chỉ chặn setState khi đã unmount; fetch vẫn chạy tiếp để điền cache
    return () => { mounted = false; };
  }, []);

  // Account filtering from PocketBase Auth
  const defaultAccount = useMemo(() => {
    const rawArea = pb.authStore.model?.area || '';
    const norm = typeof rawArea === 'string' ? rawArea.toLowerCase() : '';
    if (norm.includes('tiền hải')   || norm.includes('kcnth'))  return 'KCNTH';
    if (norm.includes('phong điền') || norm.includes('kcnpđ') || norm.includes('kcnpd')) return 'KCNPĐ';
    if (norm.includes('thuận thành')|| norm.includes('kcntti')) return 'KCNTTI';
    if (norm.includes('yên mỹ')     || norm.includes('kcnym'))  return 'KCNYM';
    if (norm.includes('số 3')       || norm.includes('kcn03'))  return 'KCN03';
    return 'all'; // admin hoặc không xác định
  }, []);

  // Secure: Lock active account selection to defaultAccount (no selection option)
  const selectedAccount = defaultAccount;
  const activeAreaName = ACCOUNT_MAP[selectedAccount] || 'Tất cả khu vực';

  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'unpaid'>('all');

  // Custom sticky selectors for Customer 1 and Customer 2 charts
  const [cust1, setCust1] = useState<string>('');
  const [cust2, setCust2] = useState<string>('');
  const [lastMonthKey, setLastMonthKey] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 10;

  // State to filter visible years in load charts
  const [visibleYears, setVisibleYears] = useState<number[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  // 1. Process Raw CSV
  const allRecords = useMemo(() => {
    if (!csvContent) return [];
    const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = parseCSVRow(lines[0]);
    const maIdx = headers.indexOf("Mã khách hàng");
    const tenIdx = headers.indexOf("Tên khách hàng");
    const ngayXuatIdx = headers.indexOf("Ngày xuất hóa đơn");
    const ngayChotIdx = headers.indexOf("Ngày chốt chỉ số");
    const ngayThanhToanIdx = headers.indexOf("Ngày thanh toán");
    const sanLuongIdx = headers.indexOf("Sản lượng");
    const doanhThuIdx = headers.indexOf("Doanh thu");
    const sauThueIdx = headers.indexOf("Số tiền sau thuế");
    const kyIdx = headers.indexOf("Kỳ");
    const diaChiIdx = headers.indexOf("Địa chỉ");

    const records: BillRecord[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      if (cols.length < Math.max(maIdx, tenIdx, ngayXuatIdx)) continue;

      const maKH = cols[maIdx] || '';
      if (!maKH) continue;

      const tenKH = cols[tenIdx] || '';
      const ngayXuat = cols[ngayXuatIdx] || '';
      const ngayChotChiSo = ngayChotIdx !== -1 ? cols[ngayChotIdx] || '' : '';
      const ngayThanhToan = cols[ngayThanhToanIdx] || '';
      const ky = cols[kyIdx] || '1';
      const diaChi = diaChiIdx !== -1 ? (cols[diaChiIdx] || '').trim() : '';

      const parseVal = (str: string) => {
        const cleaned = (str || '').replace(/[^\d]/g, '');
        return parseInt(cleaned, 10) || 0;
      };

      const sanLuong = parseVal(cols[sanLuongIdx]);
      const doanhThu = parseVal(cols[doanhThuIdx]);
      const sauThue = parseVal(cols[sauThueIdx]);

      // Dùng ngayChotChiSo làm mốc cho biểu đồ; fallback sang ngayXuat nếu trống
      const chartDate = (ngayChotChiSo && ngayChotChiSo.trim()) ? ngayChotChiSo.trim() : ngayXuat;
      const parts = chartDate.split('/');
      const thangNam = parts.length >= 3 ? `${parts[1]}/${parts[2]}` : 'Khác';

      records.push({
        maKH,
        tenKH,
        ngayXuat,
        ngayChotChiSo,
        chartDate,
        ngayThanhToan,
        ky,
        sanLuong,
        doanhThu,
        sauThue,
        thangNam,
        daThanhToan: ngayThanhToan.trim() !== '',
        diaChi
      });
    }
    return records;
  }, [csvContent]);

  // 2. Filter records dynamically based on active Account selection
  const accountFilteredRecords = useMemo(() => {
    if (selectedAccount === 'all') return allRecords;
    return allRecords.filter(r => r.diaChi === selectedAccount);
  }, [allRecords, selectedAccount]);

  // Extract available unique years globally for this account
  const uniqueYears = useMemo(() => {
    const yearsSet = new Set<number>();
    accountFilteredRecords.forEach(r => {
      const parts = r.chartDate.split('/');
      if (parts.length >= 3) {
        const yr = parseInt(parts[2], 10);
        if (yr) yearsSet.add(yr);
      }
    });
    const sorted = Array.from(yearsSet).sort((a, b) => b - a);
    return sorted.length > 0 ? sorted : [new Date().getFullYear()];
  }, [accountFilteredRecords]);

  // Chronological years (e.g. 2024, 2025, 2026) for chart sidebar columns
  const chronologicalYears = useMemo(() => {
    return [...uniqueYears].sort((a, b) => a - b);
  }, [uniqueYears]);

  // Synchronize visibleYears dynamically (Default to ALL years)
  useEffect(() => {
    if (uniqueYears.length > 0) {
      setVisibleYears([...uniqueYears]);
    }
  }, [uniqueYears]);

  const visibleChronologicalYears = useMemo(() => {
    return chronologicalYears.filter(yr => visibleYears.includes(yr));
  }, [chronologicalYears, visibleYears]);

  const toggleYear = (yr: number) => {
    setVisibleYears(prev => {
      if (prev.includes(yr)) {
        if (prev.length === 1) return prev; // Do not allow emptying all years
        return prev.filter(y => y !== yr);
      } else {
        return [...prev, yr].sort((a, b) => b - a);
      }
    });
  };

  // Adjust active selectedYear if it becomes invalid or not in uniqueYears
  useEffect(() => {
    if (uniqueYears.length > 0 && !uniqueYears.includes(selectedYear)) {
      setSelectedYear(uniqueYears[0]);
    }
  }, [uniqueYears, selectedYear]);

  // Extract available months for the active selection
  const uniqueMonths = useMemo(() => {
    const months = Array.from(new Set(accountFilteredRecords.map(r => r.thangNam))).filter(m => m !== 'Khác') as string[];
    return sortMonths(months);
  }, [accountFilteredRecords]);

  // Fetch unique customers of the active account
  const uniqueCustomers = useMemo(() => {
    const list: { maKH: string; tenKH: string }[] = [];
    const seen = new Set<string>();
    accountFilteredRecords.forEach(r => {
      if (!seen.has(r.maKH)) {
        seen.add(r.maKH);
        list.push({ maKH: r.maKH, tenKH: r.tenKH });
      }
    });
    return list.sort((a, b) => a.maKH.localeCompare(b.maKH));
  }, [accountFilteredRecords]);

  // Set default month & customer
  useEffect(() => {
    if (uniqueMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(uniqueMonths[uniqueMonths.length - 1]); // default to latest month
    }
  }, [uniqueMonths, selectedMonth]);

  // Handle month selection reset pagination
  const handleMonthChange = (val: string) => {
    setSelectedMonth(val);
    setCurrentPage(1);
  };

  // Filter records of the designated Month
  const filteredRecords = useMemo(() => {
    if (!selectedMonth) return [];
    return accountFilteredRecords.filter(r => r.thangNam === selectedMonth);
  }, [accountFilteredRecords, selectedMonth]);

  // Calculate customer-level statuses for active month with pivot dates
  const customerSummaryMap = useMemo(() => {
    const map: Record<string, CustomerSummary> = {};

    filteredRecords.forEach(r => {
      const key = `${r.maKH}_${r.thangNam}`;
      if (!map[key]) {
        map[key] = {
          id: key,
          maKH: r.maKH,
          tenKH: r.tenKH,
          thangNam: r.thangNam,
          totalSanLuong: 0,
          totalDoanhThu: 0,
          totalSauThue: 0,
          isPaid: true,
          paymentDates: [],
          readingDates: [],
          bills: [],
          latestReadingDate: '',
          latestPaymentDate: ''
        };
      }
      const item = map[key];
      item.totalSanLuong += r.sanLuong;
      item.totalDoanhThu += r.doanhThu;
      item.totalSauThue += r.sauThue;
      item.bills.push(r);

      if (r.daThanhToan) {
        if (r.ngayThanhToan && !item.paymentDates.includes(r.ngayThanhToan)) {
          item.paymentDates.push(r.ngayThanhToan);
        }
      } else {
        item.isPaid = false;
      }

      const readingDateVal = r.ngayChotChiSo || r.ngayXuat;
      if (readingDateVal && !item.readingDates.includes(readingDateVal)) {
        item.readingDates.push(readingDateVal);
      }
    });

    // Calculate dates from the bill with the newest indexes reading date
    Object.values(map).forEach(item => {
      if (item.bills.length > 0) {
        let latestBill = item.bills[0];
        let latestTime = parseDateString(latestBill.ngayChotChiSo || latestBill.ngayXuat);

        for (let i = 1; i < item.bills.length; i++) {
          const b = item.bills[i];
          const bTime = parseDateString(b.ngayChotChiSo || b.ngayXuat);
          if (bTime > latestTime) {
            latestTime = bTime;
            latestBill = b;
          }
        }
        item.latestReadingDate = latestBill.ngayChotChiSo || latestBill.ngayXuat || '—';
        item.latestPaymentDate = latestBill.ngayThanhToan || '—';
      } else {
        item.latestReadingDate = '—';
        item.latestPaymentDate = '—';
      }
    });

    return map;
  }, [filteredRecords]);

  const customerList = useMemo(() => {
    return (Object.values(customerSummaryMap) as CustomerSummary[]).sort((a, b: CustomerSummary) => {
      const cmp = a.maKH.localeCompare(b.maKH, 'vi', { numeric: true });
      if (cmp !== 0) return cmp;
      return b.thangNam.localeCompare(a.thangNam, 'vi', { numeric: true });
    });
  }, [customerSummaryMap]);

  // ALL-TIME calculations (KPI 1 and 2), before tax, filtered strictly by Account
  const allTimeRevenue = useMemo(() => {
    return accountFilteredRecords.reduce((sum, r) => sum + r.doanhThu, 0);
  }, [accountFilteredRecords]);

  const allTimeSanLuong = useMemo(() => {
    return accountFilteredRecords.reduce((sum, r) => sum + r.sanLuong, 0);
  }, [accountFilteredRecords]);

  // Active month client statistics
  const kpis = useMemo(() => {
    const totalCusts = customerList.length;
    const paidCusts = customerList.filter(c => c.isPaid).length;
    const unpaidCusts = totalCusts - paidCusts;

    return {
      totalCustomers: totalCusts,
      paidCustomers: paidCusts,
      unpaidCustomers: unpaidCusts
    };
  }, [customerList]);

  // ALL-TIME calculations for Unpaid Card:
  // Calculate the total number of unique customers and unique unpaid customers across all cycles for this account.
  const overallUnpaidKpis = useMemo(() => {
    const unpaidCustsSet = new Set<string>();
    const totalCustsSet = new Set<string>();

    accountFilteredRecords.forEach(r => {
      totalCustsSet.add(r.maKH);
      if (!r.daThanhToan) {
        unpaidCustsSet.add(r.maKH);
      }
    });

    return {
      totalCustomers: totalCustsSet.size,
      unpaidCustomers: unpaidCustsSet.size,
      isAnyUnpaid: unpaidCustsSet.size > 0
    };
  }, [accountFilteredRecords]);

  // Calculate revenue and load per year for the active selection of visible years
  const selectedYearsKpis = useMemo(() => {
    const dataByYear: { [year: number]: { revenue: number; load: number } } = {};
    
    visibleYears.forEach(yr => {
      dataByYear[yr] = { revenue: 0, load: 0 };
    });

    accountFilteredRecords.forEach(r => {
      const parts = r.chartDate.split('/');
      if (parts.length >= 3) {
        const yr = parseInt(parts[2], 10);
        if (visibleYears.includes(yr)) {
          if (!dataByYear[yr]) {
            dataByYear[yr] = { revenue: 0, load: 0 };
          }
          dataByYear[yr].revenue += r.doanhThu;
          dataByYear[yr].load += r.sanLuong;
        }
      }
    });

    return dataByYear;
  }, [accountFilteredRecords, visibleYears]);

  // (baselineBillsForTable đã được thay bằng customerList ở tầng display)

  // Đếm số khách còn nợ ở CÁC THÁNG KHÁC (không tính tháng đang chọn) — dùng cho thông báo floating.
  const otherMonthsUnpaidCount = useMemo(() => {
    const set = new Set<string>();
    accountFilteredRecords.forEach(r => {
      if (!r.daThanhToan && r.thangNam !== selectedMonth) {
        set.add(r.maKH);
      }
    });
    return set.size;
  }, [accountFilteredRecords, selectedMonth]);

  // Cảnh báo công nợ: bắn toast (kèm nút "Xem chi tiết") + ghi vào chuông thông báo.
  const debtToastSig = useRef<string>('');
  const jumpToDebtList = () => {
    setPaymentFilter('unpaid');
    setCurrentPage(1);
    setTimeout(() => {
      document.getElementById('debt-table-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };
  useEffect(() => {
    if (overallUnpaidKpis.isAnyUnpaid) {
      const extra = otherMonthsUnpaidCount > 0
        ? ` Trong đó ${otherMonthsUnpaidCount} khách còn nợ ở các tháng khác.`
        : '';
      const message = `Còn ${overallUnpaidKpis.unpaidCustomers} doanh nghiệp chưa thanh toán tiền điện.${extra}`;
      setLocalNotification({ id: 'debt-warning', title: 'Cảnh báo công nợ', message, type: 'info' });

      // Chỉ bắn toast khi nội dung đổi (tránh lặp mỗi lần render).
      if (debtToastSig.current !== message) {
        debtToastSig.current = message;
        notify.warning('Cảnh báo công nợ', message, {
          autoClose: false,
          confirm: { text: 'Xem chi tiết', onConfirm: jumpToDebtList },
        });
      }
    } else {
      clearLocalNotification('debt-warning');
      debtToastSig.current = '';
    }
  }, [overallUnpaidKpis.isAnyUnpaid, overallUnpaidKpis.unpaidCustomers, otherMonthsUnpaidCount]);

  // Dynamic Top 2 customers of selected month for default charts selection
  const defaultTop2 = useMemo(() => {
    const sorted = [...customerList].sort((a, b) => b.totalSanLuong - a.totalSanLuong);
    return sorted.slice(0, 2).map(c => c.maKH);
  }, [customerList]);

  // Update customer graphs Sticky Selection only on Month/Account change
  useEffect(() => {
    const currentKey = `${selectedMonth}_${selectedAccount}`;
    if (currentKey !== lastMonthKey) {
      setLastMonthKey(currentKey);
      if (defaultTop2.length > 0) {
        setCust1(defaultTop2[0]);
        setCust2(defaultTop2[1] || '');
      } else if (uniqueCustomers.length > 0) {
        setCust1(uniqueCustomers[0].maKH);
        setCust2(uniqueCustomers[1]?.maKH || '');
      } else {
        setCust1('');
        setCust2('');
      }
    }
  }, [selectedMonth, selectedAccount, defaultTop2, uniqueCustomers, lastMonthKey]);

  // High performance routine to extract 12-month multi-year load of a single customer
  const getCustomerMonthlyLoadAllYears = (custId: string) => {
    const monthsData = Array.from({ length: 12 }, (_, i) => {
      const mNum = i + 1;
      const item: any = {
        monthVal: mNum,
        monthLabel: `Thg ${mNum}`
      };
      chronologicalYears.forEach(yr => {
        item[yr.toString()] = 0;
      });
      return item;
    });

    if (!custId) return monthsData;

    accountFilteredRecords.forEach(r => {
      if (r.maKH === custId) {
        const parts = r.chartDate.split('/');
        if (parts.length >= 3) {
          const m = parseInt(parts[1], 10);
          const y = parseInt(parts[2], 10);
          if (m >= 1 && m <= 12 && chronologicalYears.includes(y)) {
            monthsData[m - 1][y.toString()] = (monthsData[m - 1][y.toString()] || 0) + r.sanLuong;
          }
        }
      }
    });

    return monthsData;
  };

  const cust1Data = useMemo(() => getCustomerMonthlyLoadAllYears(cust1), [accountFilteredRecords, chronologicalYears, cust1]);
  const cust2Data = useMemo(() => getCustomerMonthlyLoadAllYears(cust2), [accountFilteredRecords, chronologicalYears, cust2]);

  // Multi-Year Monthly Grouped load comparison (Same Month over multiple Years)
  const monthlySystemLoadOfAllYears = useMemo(() => {
    const monthsData = Array.from({ length: 12 }, (_, i) => {
      const mNum = i + 1;
      const item: any = {
        monthVal: mNum,
        monthLabel: `Tháng ${mNum}`
      };
      // Init all chronological years with 0
      chronologicalYears.forEach(yr => {
        item[yr.toString()] = 0;
      });
      return item;
    });

    accountFilteredRecords.forEach(r => {
      const parts = r.chartDate.split('/');
      if (parts.length >= 3) {
        const m = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (m >= 1 && m <= 12 && chronologicalYears.includes(y)) {
          monthsData[m - 1][y.toString()] = (monthsData[m - 1][y.toString()] || 0) + r.sanLuong;
        }
      }
    });

    return monthsData;
  }, [accountFilteredRecords, chronologicalYears]);

  // Bảng hiển thị theo customer-level (1 dòng/khách hàng) — tránh trùng key và filter đúng tầng
  const displayCustomers = useMemo(() => {
    return customerList.filter(c => {
      const matchesSearch =
        c.maKH.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.tenKH.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPayment =
        paymentFilter === 'all' ? true :
        paymentFilter === 'paid' ? c.isPaid : !c.isPaid;
      return matchesSearch && matchesPayment;
    });
  }, [customerList, searchQuery, paymentFilter]);

  // Pagination Logic
  const totalPages = Math.ceil(displayCustomers.length / itemsPerPage) || 1;
  const paginatedCustomers = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return displayCustomers.slice(startIndex, startIndex + itemsPerPage);
  }, [displayCustomers, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  const toggleGroupExpansion = (id: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const isAnyUnpaid = kpis.unpaidCustomers > 0;

  // Custom pleasant color list for years
  const yearColors = ['var(--text-4)', 'var(--accent)', '#10b981', '#f59e0b', '#ec4899'];

  return (
    <div className="space-y-8 pb-12 animate-fade-in relative">
      {/* Header and Account Badge Panel */}
      <div className="vl-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 bg-accent-soft rounded-2xl text-accent">
              <TrendingUp className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-ink tracking-tight uppercase">Báo cáo tổng quan</h1>
          </div>
          <p className="text-sm text-soft max-w-2xl">
            Phân tích số liệu sản lượng điện, doanh thu và đối soát thanh toán tích hợp thời gian thực.
          </p>
          
          {/* Read Only Active Account Badge (instead of Selector) */}
          <div className="inline-flex items-center gap-2 mt-3 px-3 py-1.5 bg-subtle border border-[var(--border)] rounded-xl text-dim text-xs font-semibold">
            <Building2 className="w-4 h-4 text-accent" />
            <span>Khu vực giám sát: <strong className="text-[var(--accent)]">{activeAreaName}</strong></span>
          </div>
        </div>
      </div>

      {/* Expanded KPI Cards Grid (2 cards taking 50% width each on larger screens) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Doanh thu lũy kế + Doanh thu các năm chọn - Gộp làm một */}
        <div className="vl-card p-6 md:p-8 flex flex-col sm:flex-row justify-between hover:-translate-y-1 transition-all group gap-6">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Doanh thu trước thuế</span>
                <span className="text-xs font-black text-soft uppercase mt-0.5">Lũy kế hệ thống</span>
              </div>
              <div className="p-2.5 bg-accent-soft rounded-2xl text-accent group-hover:scale-110 transition-transform">
                <DollarSign className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-2">
              <h3 className="text-2xl font-black text-ink tracking-tight leading-none font-mono">
                {formatVND(allTimeRevenue)}
              </h3>
              <p className="text-[11px] text-faint mt-2 font-bold flex items-center gap-1 font-sans">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                <span>Tổng tất cả chu kỳ</span>
              </p>
            </div>
          </div>
          
          <div className="w-full sm:w-[240px] sm:border-l border-dashed border-slate-250 sm:pl-6 flex flex-col justify-center">
            <span className="text-[10px] font-bold text-faint uppercase tracking-wider block mb-2">Doanh thu năm chọn:</span>
            <div className="space-y-1.5">
              {visibleYears.map(yr => {
                const rev = selectedYearsKpis[yr]?.revenue || 0;
                return (
                  <div key={yr} className="flex items-center justify-between text-xs font-mono border-b border-dashed border-[var(--border)] pb-1 last:border-b-0 last:pb-0">
                    <span className="text-faint font-bold">Năm {yr}:</span>
                    <span className="text-dim font-extrabold">{formatVND(rev)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sản lượng lũy kế + Sản lượng các năm chọn - Gộp làm một */}
        <div className="vl-card p-6 md:p-8 flex flex-col sm:flex-row justify-between hover:-translate-y-1 transition-all group gap-6">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-warn uppercase tracking-wider">Sản lượng thực tế</span>
                <span className="text-xs font-black text-soft uppercase mt-0.5">Lũy kế hệ thống</span>
              </div>
              <div className="p-2.5 bg-[var(--warning-soft)] rounded-2xl text-amber-500 group-hover:scale-110 transition-transform">
                <Zap className="w-5 h-5 text-amber-500" />
              </div>
            </div>
            <div className="mt-2">
              <h3 className="text-2xl font-black text-ink tracking-tight leading-none font-mono">
                {formatKWh(allTimeSanLuong)}
              </h3>
              <p className="text-[11px] text-faint mt-2 font-bold font-sans">
                Lượng điện tiêu thụ thực tế
              </p>
            </div>
          </div>

          <div className="w-full sm:w-[240px] sm:border-l border-dashed border-slate-250 sm:pl-6 flex flex-col justify-center">
            <span className="text-[10px] font-bold text-faint uppercase tracking-wider block mb-2">Sản lượng năm chọn:</span>
            <div className="space-y-1.5">
              {visibleYears.map(yr => {
                const val = selectedYearsKpis[yr]?.load || 0;
                return (
                  <div key={yr} className="flex items-center justify-between text-xs font-mono border-b border-dashed border-[var(--border)] pb-1 last:border-b-0 last:pb-0">
                    <span className="text-faint font-bold">Năm {yr}:</span>
                    <span className="text-warn font-extrabold">{formatKWh(val)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Main Monthly General Chart - DETAILED CHRONOLOGICAL MULTI-YEAR COMPLETION */}
      <div className="vl-card p-6 md:p-8 flex flex-col justify-between min-h-[580px]">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-xl font-black text-ink tracking-tight">Biểu đồ phụ tải (kWh)</h3>
            </div>
            
            {/* Interactive Year Toggles (No border as requested) */}
            <div className="flex flex-wrap items-center gap-2 bg-subtle px-4 py-2 rounded-2xl">
              {chronologicalYears.map((yr, idx) => {
                const isActive = visibleYears.includes(yr);
                const color = yearColors[idx % yearColors.length];
                return (
                  <button
                    key={yr}
                    onClick={() => toggleYear(yr)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold border transition-all duration-250 cursor-pointer ${
                      isActive 
                        ? 'bg-accent text-white border-accent shadow-sm'
                        : 'bg-surface text-faint border-[var(--border)] hover:bg-subtle hover:text-dim'
                    }`}
                  >
                    <span 
                      className={`w-3 h-3 rounded flex items-center justify-center text-[9px] text-white font-black transition-all`}
                      style={{ backgroundColor: color }}
                    >
                      {isActive && '✓'}
                    </span>
                    <span>Năm {yr}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
  
        {/* Column Chart - Precise Chronological Comparison */}
        <div className="h-[440px] w-full font-sans">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlySystemLoadOfAllYears} margin={{ top: 25, right: 10, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
              <XAxis dataKey="monthLabel" tickLine={false} stroke="var(--text-3)" style={{ fontSize: '11px', fontWeight: 'bold' }} />
              <Tooltip 
                contentStyle={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: '0.6rem', color: 'var(--text-1)', fontSize: '11px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)' }}
                labelStyle={{ fontWeight: 800, color: 'var(--text-1)', fontSize: '11px' }}
                wrapperStyle={{ zIndex: 60 }}
                cursor={{ fill: 'rgba(226, 232, 240, 0.4)' }}
                formatter={(value: any, name: any) => [new Intl.NumberFormat('vi-VN').format(Number(value)) + ' kWh', `Năm ${name}`]}
              />
              {visibleChronologicalYears.map((yr) => (
                <Bar
                  key={yr}
                  dataKey={yr.toString()}
                  fill={yearColors[chronologicalYears.indexOf(yr) % yearColors.length]}
                  radius={[5, 5, 0, 0]}
                  name={`${yr}`}
                >
                  <LabelList
                    dataKey={yr.toString()}
                    position="top"
                    formatter={formatChartLabel}
                    style={{ fontSize: '9px', fontWeight: '700', fill: 'var(--text-2)' }}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Dual Comparative Customer Load Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Customer Chart 1 */}
        <div className="vl-card p-6 flex flex-col justify-between min-h-[460px]">
          <div>
            <div className="flex flex-col gap-3 mb-6">
              <label className="block text-[10px] font-black text-faint tracking-wider uppercase font-mono">Biểu đồ phụ tải khách hàng A</label>
              
              {/* Selector is styled beautifully with blue theme when selected */}
              <div className={`border rounded p-3 flex items-center gap-3 transition-colors ${
                cust1 
                  ? 'bg-accent-soft border-accent ring-4 ring-[var(--accent-soft)]'
                  : 'bg-subtle border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}>
                <Building2 className={`w-5 h-5 shrink-0 ${cust1 ? 'text-accent' : 'text-faint'}`} />
                <div className="flex-1 min-w-0">
                  <Select
                    variant="bare"
                    searchable
                    value={cust1}
                    onChange={setCust1}
                    placeholder="-- Click chọn khách hàng A --"
                    options={[{ value: '', label: '-- Click chọn khách hàng A --' }, ...uniqueCustomers.map(c => ({ value: c.maKH, label: `[${c.maKH}] ${c.tenKH}` }))]}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Line Chart 1 */}
          <div className="h-64 w-full text-dim">
            {cust1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cust1Data} margin={{ top: 22, right: 16, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="monthLabel" tickLine={false} stroke="var(--text-4)" style={{ fontSize: '10px' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: '0.6rem', color: 'var(--text-1)', fontSize: '11px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)' }}
                    labelStyle={{ fontWeight: 800, color: 'var(--text-1)', fontSize: '11px' }}
                    wrapperStyle={{ zIndex: 60 }}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                    formatter={(value: any, name: any) => [new Intl.NumberFormat('vi-VN').format(Number(value)) + ' kWh', `Năm ${name}`]}
                  />
                  {visibleChronologicalYears.map((yr) => (
                    <Line
                      key={yr}
                      type="monotone"
                      dataKey={yr.toString()}
                      stroke={yearColors[chronologicalYears.indexOf(yr) % yearColors.length]}
                      strokeWidth={2.5}
                      activeDot={{ r: 5 }}
                      name={`${yr}`}
                    >
                      <LabelList
                        dataKey={yr.toString()}
                        position="top"
                        formatter={formatChartLabel}
                        style={{ fontSize: '9px', fontWeight: '700', fill: 'var(--text-2)' }}
                      />
                    </Line>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-faint">
                <HelpCircle className="w-8 h-8 text-faint mb-2 animate-pulse" />
                <p className="text-xs font-semibold">Vui lòng chọn khách hàng A</p>
              </div>
            )}
          </div>
        </div>

        {/* Customer Chart 2 */}
        <div className="vl-card p-6 flex flex-col justify-between min-h-[460px]">
          <div>
            <div className="flex flex-col gap-3 mb-6">
              <label className="block text-[10px] font-black text-faint tracking-wider uppercase font-mono">Biểu đồ phụ tải khách hàng B</label>
              
              {/* Selector is styled beautifully with blue theme when selected */}
              <div className={`border rounded p-3 flex items-center gap-3 transition-colors ${
                cust2 
                  ? 'bg-accent-soft border-accent ring-4 ring-[var(--accent-soft)]'
                  : 'bg-subtle border-[var(--border)] hover:border-[var(--border-strong)]'
              }`}>
                <Building2 className={`w-5 h-5 shrink-0 ${cust2 ? 'text-accent' : 'text-faint'}`} />
                <div className="flex-1 min-w-0">
                  <Select
                    variant="bare"
                    searchable
                    value={cust2}
                    onChange={setCust2}
                    placeholder="-- Click chọn khách hàng B --"
                    options={[{ value: '', label: '-- Click chọn khách hàng B --' }, ...uniqueCustomers.map(c => ({ value: c.maKH, label: `[${c.maKH}] ${c.tenKH}` }))]}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Line Chart 2 */}
          <div className="h-64 w-full text-dim">
            {cust2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cust2Data} margin={{ top: 22, right: 16, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--surface-inset)" />
                  <XAxis dataKey="monthLabel" tickLine={false} stroke="var(--text-4)" style={{ fontSize: '10px' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: '0.6rem', color: 'var(--text-1)', fontSize: '11px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)' }}
                    labelStyle={{ fontWeight: 800, color: 'var(--text-1)', fontSize: '11px' }}
                    wrapperStyle={{ zIndex: 60 }}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                    formatter={(value: any, name: any) => [new Intl.NumberFormat('vi-VN').format(Number(value)) + ' kWh', `Năm ${name}`]}
                  />
                  {visibleChronologicalYears.map((yr) => (
                    <Line
                      key={yr}
                      type="monotone"
                      dataKey={yr.toString()}
                      stroke={yearColors[chronologicalYears.indexOf(yr) % yearColors.length]}
                      strokeWidth={2.5}
                      activeDot={{ r: 5 }}
                      name={`${yr}`}
                    >
                      <LabelList
                        dataKey={yr.toString()}
                        position="top"
                        formatter={formatChartLabel}
                        style={{ fontSize: '9px', fontWeight: '700', fill: 'var(--text-2)' }}
                      />
                    </Line>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-faint">
                <HelpCircle className="w-8 h-8 text-faint mb-2 animate-pulse" />
                <p className="text-xs font-semibold">Vui lòng chọn khách hàng B</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Customer Breakdown Grid & Table */}
      <div id="debt-table-section" className="vl-card overflow-hidden scroll-mt-6">
        {/* Table Control Header */}
        <div className="p-6 md:p-8 border-b border-slate-150 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-subtle/50">
          <div>
            <h3 className="text-lg font-black text-ink tracking-tight">Danh sách công nợ khách hàng</h3>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-faint absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input 
                type="text"
                placeholder="Tìm Mã KH, tên công ty..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pl-10 pr-4 py-2 border border-[var(--border)] bg-surface rounded text-dim text-sm focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-[240px]"
              />
            </div>

            {/* Month Filter Selector moved down here */}
            <MonthPicker
              value={selectedMonth
                ? `${selectedMonth.split('/')[1]}-${selectedMonth.split('/')[0]}`
                : ''}
              onChange={(v) => {
                const [yy, mm] = v.split('-');
                handleMonthChange(`${mm}/${yy}`);
              }}
              className="min-w-[170px]"
            />

            {/* Status Filter Tab */}
            <div className="bg-subtle p-1 rounded-xl flex items-center border border-[var(--border)]">
              <button 
                onClick={() => { setPaymentFilter('all'); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${paymentFilter === 'all' ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-dim'}`}
              >
                Tất cả
              </button>
              <button 
                onClick={() => { setPaymentFilter('paid'); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'paid' ? 'bg-accent text-white shadow-sm' : 'text-faint hover:text-accent'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Đã xong
              </button>
              <button 
                onClick={() => { setPaymentFilter('unpaid'); setCurrentPage(1); }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 ${paymentFilter === 'unpaid' ? 'bg-rose-600 text-white shadow-sm' : 'text-faint hover:text-rose-600'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Còn nợ
              </button>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="vl-table w-full text-left border-collapse table-fixed min-w-[850px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-[11px] font-bold text-faint uppercase tracking-wider">
                <th className="py-4 px-4 w-[130px]">Mã khách hàng</th>
                <th className="py-4 px-4 w-[28%]">Tên doanh nghiệp</th>
                <th className="py-4 px-4 w-[14%] text-center">Ngày chốt chỉ số</th>
                <th className="py-4 px-4 w-[14%] text-center">Ngày thanh toán</th>
                <th className="py-4 px-4 w-[12%] text-right">Sản lượng điện</th>
                <th className="py-4 px-4 w-[14%] text-right">Số tiền hóa đơn</th>
                <th className="py-4 px-4 text-center w-[14%]">Trạng thái</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {paginatedCustomers.map((c) => {
                const isExpanded = !!expandedGroups[c.id];
                return (
                  <React.Fragment key={c.id}>
                    <tr
                      onClick={() => toggleGroupExpansion(c.id)}
                      className={`transition-colors text-dim text-sm hover:bg-subtle/80 cursor-pointer ${
                        !c.isPaid
                          ? 'bg-rose-50/70 border-l-4 border-l-rose-500 text-rose-950 font-semibold md:hover:bg-rose-100/30'
                          : 'bg-surface hover:bg-subtle'
                      }`}
                    >
                      <td className="py-4 px-4 font-mono font-bold text-[11px] text-soft">
                        <div className="flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-accent shrink-0" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-faint shrink-0" />
                          )}
                          <span className="truncate">{c.maKH}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-semibold text-ink whitespace-normal break-words leading-snug">
                        <div className="flex flex-col">
                          <span className="text-ink hover:text-accent transition-colors">{c.tenKH}</span>
                          <span className="text-[10px] font-bold text-accent mt-1 uppercase tracking-wider bg-accent-soft/70 px-1.5 py-0.5 rounded-md w-fit">
                            Tháng {c.thangNam}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center font-mono text-xs text-soft">
                        <div>{c.latestReadingDate}</div>
                        <div className="text-[9px] font-bold text-warn/80 mt-0.5 uppercase tracking-wide font-sans">(Mới nhất)</div>
                      </td>
                      <td className="py-4 px-4 text-center font-mono text-xs">
                        {c.latestPaymentDate !== '—' && c.latestPaymentDate ? (
                          <span className="text-ok font-bold">{c.latestPaymentDate}</span>
                        ) : (
                          <span className="text-rose-500/80 font-semibold text-[11px] bg-rose-50/30 px-1.5 py-0.5 rounded border border-rose-100/45">Chưa xong</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right font-mono font-bold text-xs text-warn">
                        {formatKWh(c.totalSanLuong)}
                      </td>
                      <td className="py-4 px-4 text-right font-mono text-ink font-bold text-xs">
                        {formatVND(c.totalSauThue)}
                      </td>
                      <td className="py-4 px-4 text-center">
                        {c.isPaid ? (
                          <span className="vl-badge-success inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            Đã thanh toán
                          </span>
                        ) : (
                          <span className="vl-badge-danger inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold rounded">
                            <XCircle className="w-3.5 h-3.5 shrink-0 animate-pulse" />
                            Còn nợ ({c.bills.filter(b => !b.daThanhToan).length} kỳ)
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable Pivot Child Rows for payment cycles */}
                    {isExpanded && c.bills.map((bill, index) => (
                      <tr 
                        key={`${c.id}_bill_${index}`}
                        className="bg-subtle/60 hover:bg-subtle/60 transition-colors border-l-[3px] border-l-[var(--accent)] text-dim text-xs"
                      >
                        <td className="py-3 px-4 font-mono font-bold text-faint pl-8">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                            <span>Kỳ {bill.ky}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-soft italic pl-6 whitespace-normal break-words leading-relaxed text-[11px]">
                          Hoá đơn ngày {bill.ngayXuat}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[11px] text-soft">
                          {bill.ngayChotChiSo || bill.ngayXuat || '—'}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-[11px]">
                          {bill.daThanhToan ? (
                            <span className="text-ok font-bold">{bill.ngayThanhToan || '—'}</span>
                          ) : (
                            <span className="text-rose-400 font-medium">Chưa thanh toán</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-warn/80 font-bold text-[11px]">
                          {formatKWh(bill.sanLuong)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-dim font-bold text-[11px]">
                          {formatVND(bill.sauThue)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {bill.daThanhToan ? (
                            <span className="vl-badge-success inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded">
                              Đã xong
                            </span>
                          ) : (
                            <span className="vl-badge-danger inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded animate-pulse">
                              Còn nợ
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {displayCustomers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-faint">
                    <div className="flex flex-col items-center justify-center">
                      <FileSpreadsheet className="w-12 h-12 text-faint mb-3" />
                      <p className="text-sm">Không tìm thấy khách hàng nào khớp bộ lọc</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        {displayCustomers.length > 0 && (
          <div className="p-4 md:p-6 bg-subtle border-t border-[var(--border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs font-semibold text-soft">
            <p>
              Hiển thị <span className="font-bold text-dim">{Math.min(displayCustomers.length, (currentPage - 1) * itemsPerPage + 1)}-{Math.min(displayCustomers.length, currentPage * itemsPerPage)}</span> trong tổng số <span className="font-bold text-dim">{displayCustomers.length}</span> khách hàng
            </p>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <button 
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 border border-[var(--border)] rounded bg-surface text-dim hover:bg-subtle disabled:opacity-50 transition-colors"
                id="btn_prev_page"
                aria-label="Trang trước"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <span className="px-3 py-1 bg-subtle border border-[var(--border)] rounded-lg text-dim font-mono">
                {currentPage} / {totalPages}
              </span>

              <button 
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="p-2 border border-[var(--border)] rounded bg-surface text-dim hover:bg-subtle disabled:opacity-50 transition-colors"
                id="btn_next_page"
                aria-label="Trang sau"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
