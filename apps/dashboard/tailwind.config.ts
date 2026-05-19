import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fff4ec",
          100: "#ffdcc0",
          400: "#ff8a3d",
          500: "#ff6600",
          600: "#e25500",
          700: "#b34200",
        },
      },
    },
  },
} satisfies Config;
