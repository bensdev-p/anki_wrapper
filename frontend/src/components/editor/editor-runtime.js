// Runs inside the sandboxed editor iframe (opaque origin, no network).
// Field HTML is only ever inserted here, never into the app's own page.
;(function () {
  'use strict'
  var root = document.getElementById('fields')
  var timers = {}

  function post(msg) {
    parent.postMessage(Object.assign({ source: 'lacuna-editor' }, msg), '*')
  }

  function report(name, html) {
    clearTimeout(timers[name])
    timers[name] = setTimeout(function () { post({ type: 'field', name: name, html: html }) }, 120)
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text) e.textContent = text
    return e
  }

  function build(fields) {
    root.textContent = ''
    fields.forEach(function (f, i) {
      var section = el('section', 'field')
      var head = el('div', 'field__head')
      var label = el('label', 'field__label', f.name)
      var toggle = el('button', 'field__toggle', 'HTML')
      toggle.type = 'button'
      toggle.setAttribute('aria-pressed', 'false')
      toggle.title = 'Edit HTML source'
      head.appendChild(label)
      head.appendChild(toggle)

      var rich = el('div', 'field__rich')
      rich.contentEditable = 'true'
      rich.innerHTML = f.html
      rich.setAttribute('role', 'textbox')
      rich.setAttribute('aria-multiline', 'true')
      rich.setAttribute('aria-label', f.name)
      var code = el('textarea', 'field__code')
      code.hidden = true
      code.spellcheck = false
      code.setAttribute('aria-label', f.name + ' (HTML)')

      rich.addEventListener('input', function () { report(f.name, rich.innerHTML) })
      code.addEventListener('input', function () { report(f.name, code.value) })
      toggle.addEventListener('click', function () {
        var toCode = code.hidden
        if (toCode) {
          code.value = rich.innerHTML
          code.style.height = Math.max(rich.offsetHeight, 80) + 'px'
        } else {
          rich.innerHTML = code.value
        }
        code.hidden = !toCode
        rich.hidden = toCode
        toggle.setAttribute('aria-pressed', String(toCode))
        ;(toCode ? code : rich).focus()
      })

      section.appendChild(head)
      section.appendChild(rich)
      section.appendChild(code)
      root.appendChild(section)
      if (i === 0) setTimeout(function () { rich.focus() }, 50)
    })
  }

  // Formatting toolbar: acts on the focused rich field.
  document.getElementById('toolbar').addEventListener('mousedown', function (e) {
    var btn = e.target.closest('button[data-cmd]')
    if (!btn) return
    e.preventDefault() // keep the selection in the field
    document.execCommand(btn.dataset.cmd, false)
    var active = document.activeElement
    if (active && active.classList.contains('field__rich')) active.dispatchEvent(new Event('input'))
  })

  // Paste as plain text so web styling doesn't leak into her notes.
  document.addEventListener('paste', function (e) {
    var t = e.target
    if (!t.closest || !t.closest('.field__rich')) return
    e.preventDefault()
    var text = (e.clipboardData || window.clipboardData).getData('text/plain')
    document.execCommand('insertText', false, text)
  })

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      Object.keys(timers).forEach(function (k) { clearTimeout(timers[k]) })
      // flush every field before saving
      document.querySelectorAll('.field').forEach(function (s) {
        var name = s.querySelector('.field__label').textContent
        var code = s.querySelector('.field__code')
        post({ type: 'field', name: name, html: code.hidden ? s.querySelector('.field__rich').innerHTML : code.value })
      })
      post({ type: 'save' })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      post({ type: 'close' })
    }
  })

  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data) return
    var msg = e.data
    if (msg.type === 'load') build(msg.fields)
    else if (msg.type === 'theme') {
      for (var k in msg.vars) document.documentElement.style.setProperty('--' + k, msg.vars[k])
      document.documentElement.style.colorScheme = msg.night ? 'dark' : 'light'
    }
  })

  post({ type: 'ready' })
})()
