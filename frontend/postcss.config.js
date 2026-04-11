export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {
      overrideBrowserslist: [
        'last 2 versions',
        'not dead',
        '> 0.2%',
        'Firefox ESR',
        'not IE 11'
      ],
      flexbox: 'no-2009',
      add: true,
      remove: false
    },
  },
}
