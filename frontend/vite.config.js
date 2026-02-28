import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const apihost = process?.env?.API_HOST ?? 'http://localhost:9300';
console.log(apihost);

// https://vite.dev/config/
export default defineConfig({
    root: '',
    base: '/',
    plugins: [
        react(),
        VitePWA({
            strategies: 'injectManifest',
            injectRegister: 'auto',
        }),
    ],
    server: {
        host: true,
        port: 3000,
        /*https: {
            key: fs.readFileSync('../certs/private.pem'),
            cert: fs.readFileSync('../certs/public.pem'),
        },*/
        proxy: {
            '/api': {
                target: apihost,
                changeOrigin: true,
            },
        },
    },
});
