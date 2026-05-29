import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/**
 * Single root config: Vite + React, path alias, and the Tailwind/PostCSS pipeline
 * inlined here so there are no extra postcss/tailwind config files at the root.
 * Theme tokens are ported from the Orange One landing (index.html :root).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173, open: true },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: ["./index.html", "./src/**/*.{ts,tsx}"],
          theme: {
            extend: {
              colors: {
                orange: { DEFAULT: "#FF6A1F", 2: "#FF8A3D", soft: "#FFF1E8" },
                navy: { DEFAULT: "#0B1B40", 2: "#15294F" },
                sidebar: "#162542",
                ink: "#0B1B40",
                page: "#F6F9FD",
                grey: { DEFAULT: "#64748B", 2: "#8A99B0" },
                line: "#E9EEF6",
                teal: "#2EC4B6",
                blue: "#3B82F6",
                yellow: "#F8B62B",
                ryg: { red: "#E5484D", yellow: "#F8B62B", green: "#27AE60" },
              },
              fontFamily: { sans: ["Poppins", "system-ui", "sans-serif"] },
              borderRadius: { card: "16px", "card-lg": "20px", pill: "999px" },
              boxShadow: {
                card: "0 18px 40px -22px rgba(15,35,75,.20)",
                soft: "0 10px 30px -18px rgba(15,35,75,.18)",
                cta: "0 16px 30px -12px rgba(255,106,31,.55)",
              },
              backgroundImage: {
                "orange-grad": "linear-gradient(135deg,#FF6A1F 0%,#FF8A3D 100%)",
                "page-grad":
                  "radial-gradient(900px 520px at 92% -8%, #FFEDE1 0%, rgba(255,237,225,0) 60%), radial-gradient(700px 480px at -6% 110%, #FFF2E9 0%, rgba(255,242,233,0) 55%), linear-gradient(180deg,#FBFCFE 0%, #F4F7FC 100%)",
              },
            },
          },
          plugins: [],
        }),
        autoprefixer(),
      ],
    },
  },
});
