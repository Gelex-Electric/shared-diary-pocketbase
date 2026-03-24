import { useState, useEffect } from 'react';
import { pb } from './lib/pocketbase';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
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

  if (isAuth === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <RefreshCw className="w-10 h-10 text-emerald-600 animate-spin" />
      </div>
    );
  }

  return isAuth ? <Dashboard /> : <Login />;
}
