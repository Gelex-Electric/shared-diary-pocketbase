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
        <h2 className="text-2xl font-bold text-slate-800">Sổ nhật ký vận hành</h2>
        <p className="text-slate-500 text-sm mt-1">Quản lý lịch trực và nhân sự trực vận hành</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl w-fit">
        <button
          onClick={() => setTab('schedule')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'schedule' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Tạo lịch trực
          </div>
        </button>
        <button
          onClick={() => setTab('staff')}
          className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'staff' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
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
