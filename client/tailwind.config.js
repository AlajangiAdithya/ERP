/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#E8EDF5',
          100: '#C5D0E6',
          200: '#9FB2D4',
          300: '#7993C1',
          400: '#5A7BB3',
          500: '#3B63A5',
          600: '#2D4F87',
          700: '#15305C',
          800: '#0F2447',
          900: '#081831',
        },
        brand: {
          red: '#E63329',
          white: '#FFFFFF',
          gray: '#ECEFF4',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
