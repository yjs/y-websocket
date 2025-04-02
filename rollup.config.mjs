  export default [{
    input: ['./src/y-websocket.js'],
    external: id => /^(lib0|yjs|y-protocols|ws|http)/.test(id),
    output: [{
      dir: 'dist',
      format: 'cjs',
      sourcemap: true,
      entryFileNames: '[name].cjs',
      chunkFileNames: '[name]-[hash].cjs'
    }]
  }
]
