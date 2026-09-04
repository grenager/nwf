import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    // Minimal black/white aesthetic: no rounded corners anywhere.
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      full: "0",
    },
    // Minimal aesthetic: no drop shadows anywhere.
    boxShadow: {
      none: "none",
      sm: "none",
      DEFAULT: "none",
      md: "none",
      lg: "none",
      xl: "none",
      "2xl": "none",
      inner: "none",
    },
    extend: {
      // The product reads as ink on paper via the built-in zinc scale, and
      // that stays true everywhere except one place. `masthead` is the single
      // accent in the app, reserved for the standing-expectation strip across
      // the top of the feed: a warm newspaper red rather than a UI red, so a
      // gentle nudge doesn't borrow the vocabulary of an error. Spending the
      // only colour on the only element that must not be scrolled past is
      // what keeps it loud; use it anywhere else and it stops working here.
      colors: {
        masthead: {
          DEFAULT: "#c1442e",
          // Slightly deeper against a near-black ground, where the lighter
          // tone glares.
          dark: "#a8382a",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
