/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#F5F8FC',
          100: '#E1E9F4',
          200: '#C2D3EA',
          300: '#99B8DB',
          400: '#6996C9',
          500: '#4778B3',
          600: '#346096',
          700: '#2A4D7C',
          800: '#264267',
          900: '#102A43', // Deep premium navy
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
          blue: '#102A43',
          blueDark: '#0A1828',
          blueLight: '#3A6BE0',
          accent: '#0EA5E9',
          red: '#E11D48',
          white: '#FFFFFF',
          gray: '#F8FAFC',
          grayDark: '#CBD5E1',
          surface: '#FFFFFF',
          muted: '#64748B',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        display: ['"Outfit"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 6px -1px rgba(16, 42, 67, 0.04), 0 2px 4px -1px rgba(16, 42, 67, 0.02)',
        cardHover: '0 10px 15px -3px rgba(16, 42, 67, 0.08), 0 4px 6px -2px rgba(16, 42, 67, 0.04)',
        glass: '0 4px 30px rgba(0, 0, 0, 0.05)',
        glow: '0 0 20px rgba(58, 107, 224, 0.25)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.1) 100%)',
      }
    },
  },
  plugins: [],
};
