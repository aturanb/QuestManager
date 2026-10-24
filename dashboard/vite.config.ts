import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy keeps the dashboard on the same origin policy as the API during
// `npm run dev` (server :3000, dashboard :5173). The admin key is sent as a
// Bearer header for REST and as ?key= for the dashboard WebSocket.
export default defineConfig({
  plugins: [react()],
  // The café's first-generation iPad Air is limited to iOS/Safari 12.
  // Use the built dashboard (preview), since Vite's dev client needs a newer browser.
  build: { target: ["safari12", "ios12"] },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/dashboard-ws": { target: "ws://localhost:3000", ws: true },
      "/cast-ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
