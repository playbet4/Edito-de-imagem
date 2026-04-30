/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        loft: {
          green: '#004D3D',
          orange: '#FF6B4A',
          /** Secondary accent from brand shapes */
          mint: '#34D399',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        loft: '0 10px 40px rgba(0, 77, 61, 0.08)',
        'loft-lg': '0 16px 48px rgba(0, 77, 61, 0.12)',
      },
    },
  },
  plugins: [],
};
