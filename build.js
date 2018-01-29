// Dependencies
const Node = {
  fs: require('fs'),
  util: require('util'),
  path: require('path')
}
const Npm = {
  stylus  : require('stylus'),
  // coffee  : require('coffee'),
  marked  : require('marked'),
  matter  : require('gray-matter'),
  handle  : require('handlebars'),
  pandoc  : require('pdc'),
  yaml    : require('js-yaml'),
  pug     : require('pug'),
  glob    : require('glob'),
  mkdirp  : require('mkdirp'),
  hljs    : require('highlight.js'),
}

// Directories
const Dir = {
  layout: 'src/layout',
  content: 'src/content',
  deploy: 'dist',
  media: 'src/assets',
}

// Shorthands and Promisification
const promisify = Node.util.promisify
const identityFn = (a) => a
const invert = (f) => (args) => !f(args)
const wtf = (e) => console.log("WTF: " + red(e))
const readFile = promisify(Node.fs.readFile)
const writeFile = promisify(Node.fs.writeFile)
const copyFile = promisify(Node.fs.copyFile)
const mkdirp = promisify(Npm.mkdirp)
const glob = (cwd, pattern) => new Promise(function(resolve, reject) {
  Npm.glob(pattern, {cwd: cwd}, function(err, files) {
    if (err) reject(err)
    else resolve(files)
  })
})

// General Helpers
function compose(...args) {
  if (!args.length) return identityFn
  const f = args.shift()
  return (x) => compose(...args)(f(x))
}
const select = (field) => (object) => object[field]
const color = (name) => (str) => {
  const termcode = (v) => `\x1b[${v}m`
  const [on, off] = Node.util.inspect.colors[name].map(termcode)
  return `${on}${str}${off}`
}
const chopExtension = (filename) => {
  // This is not watertight. It is good enough(tm).
  const parts = filename.split('.')
  const ext = parts.pop()
  return parts.join('.')
}
const getExtension = (filename) => filename.split('.').reverse()[0]
const changeExtension = (ext) => (filename) => `${chopExtension(filename)}.${ext}`
const toPrettyURL = (filename) => `${chopExtension(filename)}/index.html`

const extHTML = changeExtension('html')
const extCSS = changeExtension('css')

const red = color('red')
const green = color('green')
const blue = color('blue')
const cyan = color('cyan')
const magenta = color('magenta')
const yellow = color('yellow')

// How To Do Stuff
async function bulkProcess(srcDir, files, destDir, munge, transformer) {
  munge = munge || identityFn
  filenames = await glob(srcDir, files)
  return Promise.all(filenames.map(async (f) => {
    const content = await readFile(Node.path.join(srcDir, f), 'utf8')
    const result = await transformer(content, f)
    const destfile = Node.path.join(destDir, munge(f))
    console.log(`${blue(f)} => ${green(destfile)}`)
    await mkdirp(Node.path.dirname(destfile))
    return await writeFile(destfile, result)
  }))
}

function makeBulkTask(transformer) {
  return (srcDir, files, destDir, munge) =>
    bulkProcess(srcDir, files, destDir, munge, transformer)
}

async function index(template, srcDir, files, destDir) {
  const isIndex = (a) => a.endsWith('index.md')
  const filenames = await glob(srcDir, files)

  let indexContent = {}
  const indexFile = filenames.find(isIndex)
  if (indexFile) {
    const text = await readFile(`${srcDir}/${indexFile}`, 'utf8')
    indexContent = prepContent(text)
  }

  const metadata = filenames
    .filter(invert(isIndex))
    .map((f) => Node.fs.readFileSync(`${srcDir}/${f}`, {}).toString())
    .map(Npm.matter)
    .map(select('data'))

  const html = Npm.pug.renderFile(template, Object.assign(indexContent, {
    index: metadata,
  }))
  const destfile = `${destDir}/${Node.path.dirname(files)}/index.html`
  console.log(`Index ${yellow(files)} (${srcDir}) => ${green(destfile)}`)
  await mkdirp(Node.path.dirname(destfile))
  return await writeFile(destfile, html)
}

const makeHighlighter = (extension) => {
  const r = new Npm.marked.Renderer()
  r.paragraph = (para, wat) => {
    if (para.match(/^#!/)) {
      return `<span class="shebang">${para}</span>`
    }
    return para
  }
  r.code = (code, language) => {
    const lang = extension || language;
    const hl = Npm.hljs.highlightAuto(code, !!lang ? [lang] : undefined)
    return Npm.pug.render(`pre: code.hljs.${lang} !{code}`, {code: hl.value})
  }
  return r;
}

const prepContent = (text, markedOptions = {}) => {
  const page = Npm.matter(text)
  const content = Npm.marked(page.content, Object.assign(markedOptions, {
    breaks: false,
    smartypants: true,
  }))
  return Object.assign({content: content}, page.data)
}

const precompilePug = (template, optionsCallback) => {
  const pugFunc = Npm.pug.compileFile(template)
  return makeBulkTask((text, filename) => {
    const extras = optionsCallback ? optionsCallback(text, filename) : {};
    const data = prepContent(text, extras)
    return pugFunc(data)
  })
}

const assets = async (srcDir, files, destDir) => {
  filenames = await glob(srcDir, files)
  return Promise.all(filenames.map(async (f) => {
    const srcfile = Node.path.join(srcDir, f)
    const destfile = Node.path.join(destDir, f)
    console.log(`${cyan(f)} => ${green(destfile)}`)
    await mkdirp(Node.path.dirname(destfile))
    return await copyFile(srcfile, destfile)
  })).catch(wtf)
}

const renderPages = (template, optionsCallback) => precompilePug(`${Dir.layout}/${template}.pug`, optionsCallback)

// e.g. 'README.coffee.md' => 'coffee', 'aoc.pl.md' => 'pl'
const highlightLiterate = (_, filename) => {
  return { renderer: makeHighlighter(getExtension(chopExtension(filename))) }
}

const tunes = renderPages('tunes')
const games = renderPages('project')
const home = renderPages('homepage')
const other = renderPages('page')
const words = renderPages('page')
const lprog = renderPages('page', highlightLiterate)
const stylus = makeBulkTask((text, filename) => new Promise((resolve, reject) => {
  Npm.stylus.render(text, {}, (err, css) => {
    if (err) reject(err)
    else resolve(css)
  })
}))




try {
  home(Dir.content, 'index.md', Dir.deploy, extHTML)
  lprog(Dir.content, 'lp/*.md', Dir.deploy, compose(chopExtension, toPrettyURL))
  other(Dir.content, '{bio,resume}.md', Dir.deploy, toPrettyURL)
  tunes(Dir.content, 'tunes.md', Dir.deploy, toPrettyURL)
  games(Dir.content, 'projects/*.md', Dir.deploy, toPrettyURL)
  words(Dir.content, 'words/*.md', Dir.deploy, toPrettyURL)
  index(`${Dir.layout}/projectlist.pug`, Dir.content, 'projects/*.md', Dir.deploy)
  index(`${Dir.layout}/postlist.pug`, Dir.content, 'words/*.md', Dir.deploy)
  stylus(Dir.media, '**/*.styl', Dir.deploy, extCSS, { })
  assets(Dir.media, '{images,icons}/**/*.*', `${Dir.deploy}/assets`)
} catch  (err) {
  console.log(`caught ${err}`)
}
