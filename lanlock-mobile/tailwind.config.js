/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: "#FF4655",
        secondary: "#0F1923",
        background: "#0F1923",
        surface: "#1A242D",
        accent: "#BD3944",
        action: "#FDE047",
        text: {
          primary: "#FFFFFF",
          secondary: "#A0AEC0",
          muted: "#718096",
        },
      },
    },
  },
  plugins: [],
};
