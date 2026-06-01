import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Single root config: Vite + React, path aliases, and the Tailwind/PostCSS pipeline
 * inlined here so there are no extra postcss/tailwind config files at the root.
 *
 * The theme below merges two token systems:
 *  - Orange One's original hex tokens (orange/navy/sidebar/ink/page/grey/...).
 *  - The Receivables Hub's shadcn HSL-variable tokens (primary/muted/card/...),
 *    backed by CSS variables defined in src/index.css.
 * Colliding names (`navy`, `sidebar`) keep Orange One's DEFAULT and gain the Hub's
 * extra shades, so Orange One renders unchanged while the embedded Hub app themes
 * correctly. `borderColor.DEFAULT` is set to the Hub's --border token so Radix
 * components that portal to <body> (outside any wrapper) still get correct borders.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@hub": fileURLToPath(new URL("./src/apps/receivables-hub", import.meta.url)),
    },
    // Radix/shadcn are sensitive to duplicate React copies.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  server: { port: 5173, open: true },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          darkMode: ["class"],
          content: ["./index.html", "./src/**/*.{ts,tsx}"],
          theme: {
            container: {
              center: true,
              padding: "2rem",
              screens: { "2xl": "1400px" },
            },
            extend: {
              colors: {
                // ---- Orange One (original) ----
                orange: { DEFAULT: "#FF6A1F", 2: "#FF8A3D", soft: "#FFF1E8" },
                ink: "#0B1B40",
                page: "#F6F9FD",
                grey: { DEFAULT: "#64748B", 2: "#8A99B0" },
                line: "#E9EEF6",
                teal: "#2EC4B6",
                blue: "#3B82F6",
                yellow: "#F8B62B",
                ryg: { red: "#E5484D", yellow: "#F8B62B", green: "#27AE60" },
                // ---- merged: keep OO DEFAULT, add Hub shades ----
                navy: {
                  DEFAULT: "#0B1B40",
                  2: "#15294F",
                  deep: "hsl(var(--navy-deep))",
                  light: "hsl(var(--navy-light))",
                },
                sidebar: {
                  DEFAULT: "#162542",
                  foreground: "hsl(var(--sidebar-foreground))",
                  primary: "hsl(var(--sidebar-primary))",
                  "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
                  accent: "hsl(var(--sidebar-accent))",
                  "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
                  border: "hsl(var(--sidebar-border))",
                  ring: "hsl(var(--sidebar-ring))",
                },
                // ---- Receivables Hub (shadcn) — additive ----
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                  DEFAULT: "hsl(var(--primary))",
                  foreground: "hsl(var(--primary-foreground))",
                  hover: "hsl(var(--primary-hover))",
                },
                secondary: {
                  DEFAULT: "hsl(var(--secondary))",
                  foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                  DEFAULT: "hsl(var(--destructive))",
                  foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                  DEFAULT: "hsl(var(--muted))",
                  foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                  DEFAULT: "hsl(var(--accent))",
                  foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                  DEFAULT: "hsl(var(--popover))",
                  foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                  DEFAULT: "hsl(var(--card))",
                  foreground: "hsl(var(--card-foreground))",
                },
                surface: {
                  DEFAULT: "hsl(var(--surface))",
                  alt: "hsl(var(--surface-alt))",
                },
              },
              borderColor: {
                // Default border color = Hub token, so portaled Radix surfaces
                // (Dialog/Popover/Select/Tooltip) render correct borders outside .hub-root.
                DEFAULT: "hsl(var(--border))",
              },
              fontFamily: { sans: ["Poppins", "system-ui", "sans-serif"] },
              maxWidth: { content: "1180px" },
              borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
                card: "16px",
                "card-lg": "20px",
                button: "12px",
                input: "12px",
                pill: "999px",
              },
              boxShadow: {
                card: "0 18px 40px -22px rgba(15,35,75,.20)",
                soft: "0 10px 30px -18px rgba(15,35,75,.18)",
                cta: "0 16px 30px -12px rgba(255,106,31,.55)",
                "card-hover": "0 4px 12px rgba(16,24,40,0.08), 0 12px 32px rgba(16,24,40,0.1)",
                "cta-hover": "0 12px 40px rgba(230,126,34,0.35)",
                glow: "0 0 60px rgba(230,126,34,0.15)",
              },
              backgroundImage: {
                "orange-grad": "linear-gradient(135deg,#FF6A1F 0%,#FF8A3D 100%)",
                "page-grad":
                  "radial-gradient(900px 520px at 92% -8%, #FFEDE1 0%, rgba(255,237,225,0) 60%), radial-gradient(700px 480px at -6% 110%, #FFF2E9 0%, rgba(255,242,233,0) 55%), linear-gradient(180deg,#FBFCFE 0%, #F4F7FC 100%)",
              },
              keyframes: {
                "accordion-down": {
                  from: { height: "0" },
                  to: { height: "var(--radix-accordion-content-height)" },
                },
                "accordion-up": {
                  from: { height: "var(--radix-accordion-content-height)" },
                  to: { height: "0" },
                },
                float: {
                  "0%, 100%": { transform: "translateY(0px)" },
                  "50%": { transform: "translateY(-10px)" },
                },
              },
              animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                float: "float 6s ease-in-out infinite",
              },
            },
          },
          plugins: [tailwindcssAnimate],
        }),
        autoprefixer(),
      ],
    },
  },
});
