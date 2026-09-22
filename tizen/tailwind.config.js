/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // La app se diseña a 1920x1080 y se ve a tres metros: todas las medidas
    // van en px absolutos, sin puntos de ruptura. No es una web adaptable.
    screens: {},
    extend: {
      colors: {
        tv: {
          bg: '#141414',
          deep: '#0A0A0A',
          surface: '#1F1F1F',
          raised: '#2A2A2A',
          line: 'rgba(255,255,255,0.12)',
          text: '#FFFFFF',
          text2: '#B3B3B3',
          text3: '#808080',
          red: '#E50914',
          reddeep: '#B2070E',
          ok: '#46D369',
          warn: '#F5A623',
        },
      },
      fontFamily: {
        sans: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      // Escala tipografica de television. Nada por debajo de 18 px.
      fontSize: {
        caption: ['18px', { lineHeight: '24px' }],
        body: ['22px', { lineHeight: '30px' }],
        lead: ['26px', { lineHeight: '34px' }],
        row: ['30px', { lineHeight: '36px' }],
        h1: ['44px', { lineHeight: '50px' }],
        hero: ['64px', { lineHeight: '68px' }],
      },
    },
  },
  plugins: [],
}
