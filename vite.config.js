import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  logLevel: "info", // Suppress warnings, only show errors
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: process.env.PORT || 4000,
    allowedHosts: ["legispulse.onrender.com", ".onrender.com"],
    proxy: {
      "/api/openstates-graphql": {
        target: "https://openstates.org",
        changeOrigin: true,
        rewrite: (path) => "/graphql",
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
