import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:8001",
        // changeOrigin rewrites the Host header the backend sees, which makes
        // FastAPI's trailing-slash redirect build an absolute Location back at
        // the backend's own port. The browser then treats that redirect as
        // cross-origin and drops the Authorization header, turning every
        // trailing-slash request into a 401. Both sides are on localhost, so
        // there's no virtual-host reason to rewrite it.
        changeOrigin: false,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
