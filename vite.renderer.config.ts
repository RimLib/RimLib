import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "src/renderer/src"),
    },
  },
  plugins: [tailwindcss(), react()],
});
