import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    target: ["es2021", "chrome105", "safari15"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/agent/**", "**/src-tauri/**"],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:15123",
        changeOrigin: true,
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
