// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
var __electron_vite_injected_dirname = "C:\\Users\\lenovo\\OneDrive\\Desktop\\New folder (2)";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__electron_vite_injected_dirname, "src/main/index.ts") } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts") } } }
  },
  renderer: {
    root: resolve(__electron_vite_injected_dirname),
    resolve: { alias: { "@": resolve(__electron_vite_injected_dirname, "src/renderer") } },
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__electron_vite_injected_dirname, "index.html") } }
  }
});
export {
  electron_vite_config_default as default
};
