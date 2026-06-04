import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_PB_URL': JSON.stringify(env.VITE_PB_URL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/hes-meter': {
          target: 'http://14.225.244.63:8899',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/hes-meter/, ''),
        },
      },
    },
  };
});
