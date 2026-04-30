import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/pokezooa/",
  build: {
    chunkSizeWarningLimit: 700,
  },
  plugins: [react(), tailwindcss()],
});
