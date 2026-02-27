import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(() => {
  const tugcastPort = process.env.TUGCAST_PORT || "55255";
  return {
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
    server: {
      proxy: {
        "/auth": { target: `http://localhost:${tugcastPort}` },
        "/ws": { target: `ws://localhost:${tugcastPort}`, ws: true },
        "/api": { target: `http://localhost:${tugcastPort}` },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: false,
    },
  };
});
