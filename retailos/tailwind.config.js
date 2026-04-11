/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:       '#09090e',
        surface:  '#111117',
        surface2: '#17171f',
        surface3: '#1e1e28',
        text:     '#e4e4f0',
        text2:    '#9090aa',
        muted:    '#4a4a62',
        accent:   '#ff3333',
        accent2:  '#ff8800',
        green:    '#00e676',
        blue:     '#38bdf8',
        purple:   '#c084fc',
        yellow:   '#fbbf24',
        pink:     '#f472b6',
        teal:     '#2dd4bf',
      },
      fontFamily: {
        bebas: ['"Bebas Neue"', 'sans-serif'],
        dm:    ['"DM Sans"', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
