import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apihost = process?.env?.API_HOST ?? 'http://localhost:9300';
console.log(apihost);

// https://vite.dev/config/
export default defineConfig({
    base: '/',
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom', 'react-router-dom'],
                    mui: [
                        '@mui/material',
                        '@mui/icons-material',
                        '@mui/lab',
                        '@emotion/react',
                        '@emotion/styled',
                    ],
                    charts: ['@mui/x-charts'],
                    three: ['three', 'gaussian-splat-renderer-for-lam'],
                    state: ['effector', 'effector-react'],
                    forms: [
                        '@rjsf/core',
                        '@rjsf/mui',
                        '@rjsf/utils',
                        '@rjsf/validator-ajv8',
                    ],
                },
            },
        },
    },
    server: {
        host: true,
        port: 3000,
        allowedHosts: true,
        proxy: {
            '/api': {
                target: apihost,
                changeOrigin: true,
            },
        },
    },
});
