import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI never talks to anything but our own API; the proxy keeps it same-origin in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
