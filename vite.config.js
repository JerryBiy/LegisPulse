import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  logLevel: "error", // Suppress warnings, only show errors
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: process.env.PORT || 4000,
    allowedHosts: ["legispulse.onrender.com", ".onrender.com"],
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
