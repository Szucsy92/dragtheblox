// Standalone, offline build of the game for the Android app (native/android bundles the result).
// No SSR, no router, no network: just the Playroom component mounted by native-web/main.tsx.
// Build: `bun run build:native` -> dist-native/ (index.html + assets). The hosted site keeps using vite.config.ts.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "native-web",
  base: "./", // every asset URL relative: the app serves the bundle from its own origin
  publicDir: path.resolve(__dirname, "public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
    dedupe: ["react", "react-dom", "three"],
  },
  build: {
    outDir: path.resolve(__dirname, "dist-native"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 6000, // one self-contained bundle (three + rapier) is fine inside an APK
  },
});
