import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apihost = process?.env?.API_HOST ?? 'http://localhost:9300';
console.log(apihost);

// https://vite.dev/config/
export default defineConfig({
    root: '',
    base: '/',
    plugins: [react()],
    server: {
        host: true,
        port: 3000,
        proxy: {
            '/api': {
                target: apihost,
                changeOrigin: true,
            },
        },
    },
});
