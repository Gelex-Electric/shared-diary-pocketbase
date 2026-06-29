import { useState, useEffect } from 'react';
import { pb } from './lib/pocketbase';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import BusinessDashboard from './components/business/BusinessDashboard';
import { Toaster } from './lib/toast';
import { RefreshCw } from 'lucide-react';

export default function App() {
  const [isAuth, setIsAuth] = useState<boolean | null>(null);

  useEffect(() => {
    // Initial check
    setIsAuth(pb.authStore.isValid);

    // Listen for changes
    const unsubscribe = pb.authStore.onChange(() => {
      setIsAuth(pb.authStore.isValid);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Phân loại khối theo field 'area': có area = Vận hành, trống = Kinh doanh.
  const rawArea = pb.authStore.model?.area;
  const isBusinessUser = !rawArea || (typeof rawArea === 'string' && !rawArea.trim());

  return (
    <>
      {isAuth === null ? (
        <div className="min-h-screen flex items-center justify-center bg-canvas">
          <RefreshCw className="w-10 h-10 text-accent animate-spin" />
        </div>
      ) : !isAuth ? (
        <Login />
      ) : isBusinessUser ? (
        <BusinessDashboard />
      ) : (
        <Dashboard />
      )}

      {/* Thanh thông báo dạng toast — dùng toast.success/error/... ở bất cứ đâu */}
      <Toaster />
    </>
  );
}
