// Runs inside the sandboxed card iframe (opaque origin, scripts allowed).
// Mirrors how Anki desktop's reviewer updates its webview: one persistent
// document; #qa innerHTML is swapped per side, and card <script>s re-run.
;(function () {
  'use strict'

  // "Match theme" card style: the card sits on the app's surface. Only the
  // page background and base text color are taken over; everything else
  // (cloze colors, fonts, layout, images) stays as the deck styles it.
  // Loaded after the note type's CSS so it wins over .card { background }.
  var BLEND_CSS = [
    'html, body, body.card, .card, #qa { background-color: transparent !important; }',
    'body, body.card, .card { color: var(--fg) !important; }',
    'hr { background-color: var(--rounds-border-strong) !important; }',
    'input#typeans { background: var(--rounds-hover) !important; color: var(--fg) !important; border-color: var(--rounds-border-strong) !important; }',
    'input#typeans:focus { outline: none; border-color: var(--rounds-accent) !important; box-shadow: 0 0 0 3px var(--rounds-accent-soft); }',
    '.replay-button svg circle { fill: var(--rounds-hover) !important; stroke: var(--rounds-border-strong) !important; }',
    '.replay-button svg path { fill: var(--fg) !important; }',
    'html { scrollbar-color: var(--rounds-border-strong) transparent; }',
    '::selection { background: var(--rounds-accent-soft); }',
  ].join('\n')
  var qa = document.getElementById('qa')
  var ntCss = document.getElementById('notetype-css')
  var baseClass = ''
  var themeClass = ''

  // Storage for deck scripts. The sandbox has an opaque origin, so the real
  // sessionStorage/localStorage throw; popular note types (AnKing's
  // anki-persistence: cloze hints, shuffled lists) then break. Provide:
  //  - sessionStorage: in memory, living as long as this card document
  //    (like AnkiMobile's web view, where anki-persistence uses it);
  //  - localStorage: seeded from and saved to the app (deck preferences),
  //    namespaced, and never able to reach the app's own storage.
  function MemoryStorage(seed, onChange) {
    var data = Object.assign({}, seed || {})
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null },
      setItem: function (k, v) { data[String(k)] = String(v); if (onChange) onChange(data) },
      removeItem: function (k) { delete data[String(k)]; if (onChange) onChange(data) },
      clear: function () { data = {}; if (onChange) onChange(data) },
      key: function (i) { return Object.keys(data)[i] === undefined ? null : Object.keys(data)[i] },
    }
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length } })
    // Object.keys(sessionStorage) is used by anki-persistence: expose items as keys too.
    return new Proxy(api, {
      get: function (t, p) { return p in t ? t[p] : (Object.prototype.hasOwnProperty.call(data, p) ? data[p] : undefined) },
      ownKeys: function () { return Object.keys(data) },
      getOwnPropertyDescriptor: function (t, p) {
        return Object.prototype.hasOwnProperty.call(data, p) ? { value: data[p], enumerable: true, configurable: true } : undefined
      },
    })
  }
  var saveTimer = null
  function install(name, storage) {
    try { Object.defineProperty(window, name, { value: storage, configurable: true }) } catch { /* keep native */ }
  }
  install('sessionStorage', MemoryStorage())
  install('localStorage', MemoryStorage(window.__roundsLocal, function (data) {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(function () { post({ type: 'storage', data: data }) }, 300)
  }))

  // Globals Anki's reviewer provides that deck scripts commonly use.
  window.onUpdateHook = []
  window.onShownHook = []
  window.ankiPlatform = 'desktop'
  // pycmd bridge (aqt.reviewer._linkHandler): audio, show answer, answer buttons.
  window.pycmd = function (cmd) {
    if (typeof cmd !== 'string') return false
    if (cmd.indexOf('play:') === 0) post({ type: 'play', ref: cmd })
    else if (cmd === 'ans' || /^ease[1-4]$/.test(cmd)) post({ type: 'pycmd', cmd: cmd })
    return false
  }

  function post(msg) {
    parent.postMessage(Object.assign({ source: 'rounds-card' }, msg), '*')
  }

  function applyBodyClass() {
    document.body.className = (baseClass + ' ' + themeClass).trim()
  }

  // innerHTML doesn't execute <script>; recreate each one, in order (as Anki does).
  function runScripts(root) {
    var scripts = Array.prototype.slice.call(root.querySelectorAll('script'))
    var chain = Promise.resolve()
    scripts.forEach(function (old) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          var s = document.createElement('script')
          for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value)
          if (old.src) {
            s.onload = s.onerror = function () { resolve() }
            old.replaceWith(s)
          } else {
            s.textContent = old.textContent
            old.replaceWith(s)
            resolve()
          }
        })
      })
    })
    return chain
  }

  function runHooks(hooks) {
    var list = hooks.slice()
    hooks.length = 0
    return Promise.all(list.map(function (fn) {
      try { return Promise.resolve(fn()) } catch (e) { console.error(e) }
    }))
  }

  function render(msg) {
    window.onUpdateHook.length = 0
    window.onShownHook.length = 0
    ntCss.textContent = msg.css
    baseClass = msg.bodyClass
    applyBodyClass()
    qa.innerHTML = msg.html
    qa.classList.remove('rounds-enter')

    var answer = msg.side === 'answer' ? document.getElementById('answer') : null
    if (msg.animate) {
      if (answer) {
        var el = answer.nextElementSibling
        while (el) { el.classList.add('rounds-reveal'); el = el.nextElementSibling }
      } else {
        void qa.offsetWidth
        qa.classList.add('rounds-enter')
      }
    }
    if (msg.side === 'question') window.scrollTo(0, 0)

    runScripts(qa)
      .then(function () { return runHooks(window.onUpdateHook) })
      .then(function () {
        if (answer && msg.scrollToAnswer !== false) {
          var top = answer.getBoundingClientRect().top
          if (top > window.innerHeight * 0.6) answer.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }
        var input = document.getElementById('typeans')
        if (input && msg.side === 'question' && !msg.touch) input.focus()
        return runHooks(window.onShownHook)
      })
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parent) return
    var msg = e.data
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'render') render(msg)
    else if (msg.type === 'typeans-result') {
      var slot = document.getElementById('typeans-result')
      if (slot) {
        slot.innerHTML = msg.html
        slot.classList.add('rounds-reveal')
      }
    } else if (msg.type === 'theme') {
      themeClass = msg.bodyClass
      var root = document.documentElement
      root.style.setProperty('--canvas', msg.canvas)
      root.style.setProperty('--fg', msg.fg)
      for (var k in msg.vars || {}) root.style.setProperty('--' + k, msg.vars[k])
      root.style.colorScheme = msg.night ? 'dark' : 'light'
      root.classList.toggle('rounds-blend', !!msg.blend)
      document.getElementById('theme-blend').textContent = msg.blend ? BLEND_CSS : ''
      applyBodyClass()
    }
  })

  // Audio buttons: the parent page plays audio (it holds the user gesture).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-av]')
    if (btn) {
      e.preventDefault()
      post({ type: 'play', ref: btn.getAttribute('data-av') })
      return
    }
    // Web links (First Aid / Boards & Beyond links, references…) open in a new
    // tab, as Anki opens them in the browser, instead of replacing the card.
    var link = e.target.closest && e.target.closest('a[href]')
    if (link) {
      var href = link.getAttribute('href') || ''
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault()
        post({ type: 'open', url: href })
        return
      }
    }
    // Tapping empty card space flips / advances, like AnkiMobile.
    var interactive = e.target.closest && e.target.closest('a, button, input, textarea, select, label, summary, details, [onclick], [role="button"], .cloze-hint, [contenteditable]')
    if (!interactive && !(window.getSelection && String(window.getSelection()))) post({ type: 'tap' })
  })

  // Images that fail to load are usually media that hasn't synced to this
  // device yet (big decks carry gigabytes of First Aid / Sketchy images).
  document.addEventListener('error', function (e) {
    var t = e.target
    if (t && t.tagName === 'IMG') {
      t.classList.add('rounds-missing')
      post({ type: 'missing', src: t.getAttribute('src') || '' })
    }
  }, true)

  // Keys the study screen handles (Anki desktop's reviewer shortcuts).
  var PLAIN = ' |Enter|1|2|3|4|Escape|*|-|=|@|!|r|R|e|E|i|I|.'.split('|')
  var WITH_MOD = 'z|Z|k|K|1|2|3|4|5|6|7'.split('|')
  document.addEventListener('keydown', function (e) {
    var t = e.target
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    if (typing && !(e.key === 'Enter' || e.key === 'Escape')) return
    var mod = e.metaKey || e.ctrlKey
    if (mod ? WITH_MOD.indexOf(e.key) < 0 : PLAIN.indexOf(e.key) < 0) return
    e.preventDefault()
    post({ type: 'key', key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey })
  })

  // Typed answers: report the text as she types; show the comparison when it arrives.
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'typeans') post({ type: 'typed', value: e.target.value })
  })

  post({ type: 'ready' })
})()
