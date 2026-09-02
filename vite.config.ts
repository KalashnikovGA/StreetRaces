import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        race: resolve(__dirname, 'index.html'),
        sandbox: resolve(__dirname, 'sandbox.html'),
        garage: resolve(__dirname, 'garage.html'),
        shop: resolve(__dirname, 'shop.html'),
        pimp: resolve(__dirname, 'pimp.html'),
      },
    },
  },
});
