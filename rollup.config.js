export default {
  input: './src/y-websocket.js',
  external: id => /^(funlib|yjs|y-protocols)/.test(id),
  output: [{
    name: 'y-websocket',
    file: 'dist/y-websocket.js',
    format: 'cjs',
    sourcemap: true,
    paths: path => {
      if (/^funlib\//.test(path)) {
        return `lib0/dist${path.slice(6)}`
      } else if (/^y\-protocols\//.test(path)) {
        return `y-protocols/dist${path.slice(11)}`
      }
      return path
    }
  }]
}
