// Splits the exported web bundle into chunks under the deploy scanner's
// 512KB-per-file cap. Chunks are plain-text slices of the JS source (not
// parsed on their own), reassembled and executed client-side by loader.js.
// Split points are chosen right before a top-level `__d(` module-registration
// call so no statement is ever cut in half.
const fs = require('fs')
const path = require('path')

const bundleDir = path.join(__dirname, '..', 'dist', '_expo', 'static', 'js', 'web')
const htmlPath = path.join(__dirname, '..', 'dist', 'index.html')
const CHUNK_TARGET = 450_000 // chars; comfortably under the 512KB cap

const files = fs.readdirSync(bundleDir).filter((f) => f.endsWith('.js'))
if (files.length !== 1) {
  throw new Error(`Expected exactly one bundle .js file in ${bundleDir}, found: ${files.join(', ')}`)
}
const bundleFile = files[0]
const bundlePath = path.join(bundleDir, bundleFile)
const source = fs.readFileSync(bundlePath, 'utf8')

// Candidate split points: right before each top-level `__d(` call.
const splitPoints = []
const re = /__d\(/g
let m
while ((m = re.exec(source))) splitPoints.push(m.index)

const chunks = []
let start = 0
let nextTarget = CHUNK_TARGET
for (const idx of splitPoints) {
  if (idx - start >= nextTarget) {
    chunks.push(source.slice(start, idx))
    start = idx
    nextTarget = CHUNK_TARGET
  }
}
chunks.push(source.slice(start))

console.log(`Split ${bundleFile} (${source.length} chars) into ${chunks.length} chunks`)

// Clean up any chunks/loader from a previous split.
for (const f of fs.readdirSync(bundleDir)) {
  if (f.startsWith('chunk-') || f === 'loader.js') fs.unlinkSync(path.join(bundleDir, f))
}
fs.unlinkSync(bundlePath)

const chunkNames = chunks.map((_, i) => `chunk-${i}.txt`)
chunks.forEach((c, i) => {
  fs.writeFileSync(path.join(bundleDir, chunkNames[i]), c, 'utf8')
  console.log(`  chunk-${i}.txt: ${c.length} chars`)
})

const loaderSrc = `(function () {
  var parts = ${JSON.stringify(chunkNames.map((n) => `/_expo/static/js/web/${n}`))};
  Promise.all(parts.map(function (u) { return fetch(u).then(function (r) { return r.text() }) }))
    .then(function (texts) {
      var full = texts.join('');
      var blob = new Blob([full], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () { URL.revokeObjectURL(url) };
      document.head.appendChild(s);
    });
})();
`
fs.writeFileSync(path.join(bundleDir, 'loader.js'), loaderSrc, 'utf8')
console.log('  loader.js written')

const html = fs.readFileSync(htmlPath, 'utf8')
const updated = html.replace(
  /<script src="\/_expo\/static\/js\/web\/[^"]+\.js" defer><\/script>/,
  '<script src="/_expo/static/js/web/loader.js" defer></script>'
)
if (updated === html) throw new Error('Failed to rewrite bundle <script> tag in index.html')
fs.writeFileSync(htmlPath, updated, 'utf8')
console.log('  index.html updated')
