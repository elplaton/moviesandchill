/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // La identidad no cambia: fondo casi negro y el rojo de la marca.
        // Lo que se ordena son los grises, que antes se escribían a mano
        // (white/5, white/10, gray-400...) sin ningún criterio.
        nf: {
          red: '#E50914',
          'red-dark': '#B2070E',
          bg: '#141414',
          deep: '#0A0A0A',
          surface: '#1A1A1A',
          raised: '#232323',
          hover: '#2C2C2C',
          line: 'rgba(255,255,255,0.10)',
          text: '#FFFFFF',
          dim: '#B3B3B3',
          faint: '#8C8C8C',
          ok: '#46D369',
          warn: '#E8B339',
        },
      },
      fontFamily: {
        sans: ['Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      fontSize: {
        // Escala corta y deliberada, en vez de saltar entre diez tamaños.
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.04em' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['16px', { lineHeight: '24px' }],
        lg: ['19px', { lineHeight: '26px' }],
        title: ['24px', { lineHeight: '30px', letterSpacing: '-0.01em' }],
        page: ['34px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
        hero: ['clamp(38px, 4vw, 60px)', { lineHeight: '1.05', letterSpacing: '-0.025em' }],
      },
      spacing: { gutter: 'var(--gutter)' },
      borderRadius: { card: '6px', panel: '10px', pill: '999px' },
      boxShadow: {
        card: '0 2px 10px rgba(0,0,0,0.45)',
        lift: '0 18px 44px rgba(0,0,0,0.65)',
        panel: '0 30px 90px rgba(0,0,0,0.75)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.35s cubic-bezier(0.22,0.61,0.36,1)',
        'scale-in': 'scaleIn 0.22s cubic-bezier(0.22,0.61,0.36,1)',
      },
      keyframes: {
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(14px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        scaleIn: { '0%': { opacity: '0', transform: 'scale(0.97)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
    },
  },
  plugins: [],
}
