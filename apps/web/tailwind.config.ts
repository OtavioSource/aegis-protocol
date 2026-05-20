import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0c10',
          900: '#0f1218',
          850: '#141821',
          800: '#1a1f2b',
          700: '#262c3a',
          600: '#3a4254',
        },
        accent: {
          DEFAULT: '#5b9cff',
          soft: '#1e2c47',
        },
      },
    },
  },
  plugins: [],
};

export default config;
