import React, { useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import HandoverManager from './HandoverManager';
import ElectricShiftManager from './ElectricShiftManager';

// Gộp "Tạo lịch trực" và "Quản lý nhân sự trực" thành 1 subside "Sổ nhật ký vận hành",
// chia làm 2 tab (cùng phong cách tab với CustomerManager / Thông tin chung).
export default function JournalManager() {
  const [tab, setTab] = useState<'schedule' | 'staff'>('schedule');

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-ink">Sổ nhật ký vận hành</h2>
        <p className="text-soft text-sm mt-1">Quản lý lịch trực và nhân sự trực vận hành</p>
      </div>

      {/* Tabs */}
      <div className="vl-nav-tabs flex flex-wrap border-b border-[var(--border)]">
        <button
          onClick={() => setTab('schedule')}
          className={`vl-nav-link px-6 py-3 text-sm font-bold transition-all ${tab === 'schedule' ? 'active' : ''}`}
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Tạo lịch trực
          </div>
        </button>
        <button
          onClick={() => setTab('staff')}
          className={`vl-nav-link px-6 py-3 text-sm font-bold transition-all ${tab === 'staff' ? 'active' : ''}`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            Quản lý nhân sự trực
          </div>
        </button>
      </div>

      {tab === 'schedule' ? <HandoverManager /> : <ElectricShiftManager />}
    </div>
  );
}
