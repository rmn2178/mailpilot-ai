/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Claude-inspired restrained palette (§17)
        bg: {
          DEFAULT: "#F8F7F4",
          panel: "#FFFFFF",
          subtle: "#F1EFEA",
        },
        ink: {
          DEFAULT: "#262626",
          muted: "#77736D",
        },
        line: {
          DEFAULT: "#E7E3DC",
          strong: "#D6D1C7",
        },
        brand: {
          DEFAULT: "#6261A8",
          hover: "#54539A",
          subtle: "#EEEDF6",
        },
        info: {
          DEFAULT: "#5A7A92",
          subtle: "#E8EEF3",
        },
        success: {
          DEFAULT: "#5E8A6B",
          subtle: "#E7F0E9",
        },
        warn: {
          DEFAULT: "#B98C3E",
          subtle: "#F4ECDD",
        },
        danger: {
          DEFAULT: "#A95757",
          subtle: "#F4E3E3",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        serif: ["ui-serif", "Georgia", "Cambria", "Times New Roman", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(38,38,38,0.04), 0 1px 3px rgba(38,38,38,0.03)",
        panel: "0 1px 2px rgba(38,38,38,0.05)",
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
      },
    },
  },
  plugins: [],
};
