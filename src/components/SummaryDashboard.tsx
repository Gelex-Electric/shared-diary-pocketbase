import React from 'react';
import { LayoutDashboard } from 'lucide-react';

export default function SummaryDashboard() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
      <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6">
        <LayoutDashboard className="w-12 h-12 text-slate-200" />
      </div>
      <h2 className="text-xl font-bold text-slate-600">Hệ thống đang sẵn sàng</h2>
      <p className="text-sm mt-2">Vui lòng chọn chức năng từ thanh menu để bắt đầu</p>
    </div>
  );
}
