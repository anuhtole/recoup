import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI never talks to anything but our own API; the proxy keeps it same-origin in dev.
// Port and API default to what `make dev` starts (:5173 → :8000); set RECOUP_UI_PORT and
// RECOUP_API_TARGET to run a second pair beside it. The isolated e2e run sets both, and then
// insists on its port, so a busy port fails loudly instead of drifting onto a shared server.
const port = Number(process.env.RECOUP_UI_PORT ?? 5173);
const api = process.env.RECOUP_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port,
    strictPort: Boolean(process.env.RECOUP_UI_PORT),
    proxy: { "/api": api },
  },
});
