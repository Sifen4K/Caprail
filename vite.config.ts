import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: ["es2021", "chrome100", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: "dist",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        "screenshot-overlay": resolve(__dirname, "src/screenshot-overlay.html"),
        "record-overlay": resolve(__dirname, "src/record-overlay.html"),
        "record-control": resolve(__dirname, "src/record-control.html"),
        "settings": resolve(__dirname, "src/settings.html"),
        "editor": resolve(__dirname, "src/editor.html"),
        "clip-editor": resolve(__dirname, "src/clip-editor.html"),
        "pin": resolve(__dirname, "src/pin.html"),
      },
    },
  },
});
