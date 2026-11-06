/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nf: {
          red: '#E50914', reddeep: '#B2070E', bg: '#141414', deep: '#0A0A0A', card: '#1F1F1F', raised: '#2A2A2A',
          text2: '#B3B3B3', text3: '#808080', ok: '#46D369', warn: '#F5A623',
        },
      },
      fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'] },
      // La barra de algo en marcha cuyo total aún no se sabe.
      animation: { progreso: 'progreso 1.4s ease-in-out infinite' },
      keyframes: { progreso: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(300%)' } } },
    },
  },
  plugins: [],
}
