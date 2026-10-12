import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET } = loadEnv(
    mode,
    process.cwd(),
    'API_PROXY_TARGET',
  );

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(process.env.ISN_WEB_PORT ?? 5173),
      strictPort: true,
      proxy: {
        '/api': {
          target: API_PROXY_TARGET || 'http://127.0.0.1:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, '') || '/',
        },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      clearMocks: true,
      restoreMocks: true,
    },
  };
});
