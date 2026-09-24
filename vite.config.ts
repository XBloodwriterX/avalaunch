import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  plugins: [
    {
      name: "copy-injector-root",
      closeBundle() {
        const srcPath = path.resolve(__dirname, "dist/assets/index.js");
        const dstPath = path.resolve(__dirname, "dist/injector.js");
        const dstCosmeticPath = path.resolve(__dirname, "dist/cosmetic-injector.js");
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, dstPath);
          fs.copyFileSync(srcPath, dstCosmeticPath);
        }
      },
    },
  ],
});
