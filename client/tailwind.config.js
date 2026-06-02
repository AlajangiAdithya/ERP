/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#EEF2FA',
          100: '#D6DFF1',
          200: '#AEBFE2',
          300: '#7E96CB',
          400: '#506FAF',
          500: '#2F4F95',
          600: '#1E3A8A',
          700: '#16306E',
          800: '#102452',
          900: '#0A1838',
        },
        blue: {
          50: '#EFF5FF',
          100: '#DBE7FE',
          200: '#BAD0FC',
          300: '#8FB1F8',
          400: '#5C8AF2',
          500: '#3A6BE0',
          600: '#1E50C7',
          700: '#1E3A8A',
          800: '#172E6C',
          900: '#0F1F4D',
        },
        brand: {
          blue: '#1E3A8A',
          blueDark: '#102452',
          blueLight: '#3A6BE0',
          accent: '#DBE7FE',
          red: '#E63329',
          white: '#FFFFFF',
          gray: '#EEF1F6',
          grayDark: '#D6DBE5',
          surface: '#FFFFFF',
          muted: '#6B7385',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 36, 82, 0.04), 0 4px 12px rgba(16, 36, 82, 0.06)',
        cardHover: '0 4px 8px rgba(16, 36, 82, 0.08), 0 12px 24px rgba(16, 36, 82, 0.10)',
      },
      keyframes: {
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        marquee: 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
