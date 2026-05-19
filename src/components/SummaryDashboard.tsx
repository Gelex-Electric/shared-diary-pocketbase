import React, { useState } from 'react';
import { LayoutDashboard, RefreshCw, ExternalLink } from 'lucide-react';

const DASHBOARD_URL = 'https://gelex-electric.github.io/GETC/index.html'; // 👈 Thay URL ở đây

export default function SummaryDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LayoutDashboard className="w-5 h-5 text-emerald-600" />
          <h2 className="text-lg font-bold text-slate-700">Tổng hợp</h2>
        </div>
        
          href={DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-emerald-600 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Mở tab mới
        </a>
      </div>

      {/* iFrame container */}
      <div className="relative w-full bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden"
           style={{ height: 'calc(100vh - 180px)' }}>

        {/* Loading state */}
        {isLoading && !hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 bg-white z-10">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
            <p className="text-sm font-medium">Đang tải dashboard...</p>
          </div>
        )}

        {/* Error state */}
        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400 bg-white z-10">
            <div className="w-16 h-16 bg-red-50 rounded-[1.5rem] flex items-center justify-center mb-2">
              <LayoutDashboard className="w-8 h-8 text-red-300" />
            </div>
            <p className="text-sm font-bold text-slate-600">Không thể tải trang</p>
            <a href={DASHBOARD_URL} target="_blank" rel="noopener noreferrer"
               className="text-xs text-emerald-600 font-bold hover:underline flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> Mở trực tiếp
            </a>
          </div>
        )}

        <iframe
          src={DASHBOARD_URL}
          className="w-full h-full border-0"
          onLoad={() => setIsLoading(false)}
          onError={() => { setIsLoading(false); setHasError(true); }}
          title="Summary Dashboard"
          allow="fullscreen"
        />
      </div>
    </div>
  );
}
