import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy keeps the dashboard on the same origin policy as the API during
// `npm run dev` (server :3000, dashboard :5173). The admin key is sent as a
// Bearer header for REST and as ?key= for the dashboard WebSocket.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/dashboard-ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
