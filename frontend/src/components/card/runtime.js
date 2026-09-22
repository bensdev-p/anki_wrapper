// Runs inside the sandboxed card iframe (opaque origin, scripts allowed).
// Mirrors how Anki desktop's reviewer updates its webview: one persistent
// document; #qa innerHTML is swapped per side, and card <script>s re-run.
;(function () {
  'use strict'
  var qa = document.getElementById('qa')
  var ntCss = document.getElementById('notetype-css')
  var baseClass = ''
  var themeClass = ''

  // Globals Anki's reviewer provides that deck scripts commonly use.
  window.onUpdateHook = []
  window.onShownHook = []
  window.ankiPlatform = 'desktop'
  window.pycmd = function (cmd) {
    if (typeof cmd === 'string' && cmd.indexOf('play:') === 0) post({ type: 'play', ref: cmd })
    return false
  }

  function post(msg) {
    parent.postMessage(Object.assign({ source: 'lacuna-card' }, msg), '*')
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
    qa.classList.remove('lacuna-enter')

    var answer = msg.side === 'answer' ? document.getElementById('answer') : null
    if (msg.animate) {
      if (answer) {
        var el = answer.nextElementSibling
        while (el) { el.classList.add('lacuna-reveal'); el = el.nextElementSibling }
      } else {
        void qa.offsetWidth
        qa.classList.add('lacuna-enter')
      }
    }
    if (msg.side === 'question') window.scrollTo(0, 0)

    runScripts(qa)
      .then(function () { return runHooks(window.onUpdateHook) })
      .then(function () {
        if (answer) {
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
        slot.classList.add('lacuna-reveal')
      }
    } else if (msg.type === 'theme') {
      themeClass = msg.bodyClass
      document.documentElement.style.setProperty('--canvas', msg.canvas)
      document.documentElement.style.setProperty('--fg', msg.fg)
      document.documentElement.style.colorScheme = msg.night ? 'dark' : 'light'
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
    // Tapping empty card space flips / advances, like AnkiMobile.
    var interactive = e.target.closest && e.target.closest('a, button, input, textarea, select, label, summary, details, [onclick], [role="button"], .cloze-hint, [contenteditable]')
    if (!interactive && !(window.getSelection && String(window.getSelection()))) post({ type: 'tap' })
  })

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
