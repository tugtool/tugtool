import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // lucide@0.564 predates the exports field; point Vite at its ESM entry directly
      lucide: path.resolve(
        __dirname,
        "./node_modules/lucide/dist/esm/lucide/src/lucide.js",
      ),
    },
  },
  // Note: no server.proxy config — dev.rs serves from dist/ only;
  // `bun run dev` (Vite dev server) is for standalone frontend work
  // and uses its own WebSocket proxy configured here if needed:
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:7080",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
