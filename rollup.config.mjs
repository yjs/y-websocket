  export default [{
    input: ['./src/y-websocket.js', './bin/server.js', './bin/utils.js'],
    external: id => /^(lib0|yjs|y-protocols|ws|lodash\.debounce|http)/.test(id),
    output: [{
      dir: 'dist',
      format: 'cjs',
      sourcemap: true,
      entryFileNames: '[name].cjs',
      chunkFileNames: '[name]-[hash].cjs'
    }]
  }
]
