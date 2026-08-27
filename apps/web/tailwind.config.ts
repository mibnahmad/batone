import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f6f8',
          100: '#e9e9ee',
          200: '#c9c9d4',
          300: '#a0a0b0',
          400: '#6f6f83',
          500: '#4a4a5c',
          600: '#33333f',
          700: '#22222b',
          800: '#16161c',
          900: '#0f0f14',
          950: '#0b0b0f',
        },
        brand: {
          50: '#fff8ed',
          100: '#feefd0',
          200: '#fddba0',
          300: '#fbc165',
          400: '#f9a838',
          500: '#f5a623',
          600: '#e08706',
          700: '#ba6708',
          800: '#94500e',
          900: '#78430f',
        },
        ai: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
