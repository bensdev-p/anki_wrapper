// Runs inside the sandboxed editor iframe (opaque origin, no network).
// Field HTML is only ever inserted here, never into the app's own page.
;(function () {
  'use strict'
  var root = document.getElementById('fields')
  var timers = {}

  function post(msg) {
    parent.postMessage(Object.assign({ source: 'rounds-editor' }, msg), '*')
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
    if (btn.dataset.cmd === 'cloze') return wrapCloze(e.altKey)
    document.execCommand(btn.dataset.cmd, false)
    var active = document.activeElement
    if (active && active.classList.contains('field__rich')) active.dispatchEvent(new Event('input'))
  })

  // Images and audio pasted or dropped into a field are shown right away (from
  // a blob: URL) and uploaded by the app, which answers with the media file's
  // name; then the <img> points at the real file.
  var pending = {}
  var uploadSeq = 0
  var EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }

  function fieldOf(node) {
    return node && node.closest ? node.closest('.field__rich') : null
  }

  function insertFiles(files, rich) {
    var used = false
    Array.prototype.forEach.call(files, function (file) {
      var ext = EXT[file.type]
      if (!ext) return
      used = true
      var id = 'u' + ++uploadSeq
      var name = file.name && file.name !== 'image.png' ? file.name : 'paste-' + Date.now() + '-' + uploadSeq + '.' + ext
      var html = ext === 'mp3' || ext === 'm4a' || ext === 'ogg' || ext === 'wav'
        ? '<span data-pending="' + id + '">[sound:uploading…]</span>'
        : '<img data-pending="' + id + '" src="' + URL.createObjectURL(file) + '">'
      rich.focus()
      document.execCommand('insertHTML', false, html)
      pending[id] = rich
      file.arrayBuffer().then(function (buf) {
        post({ type: 'upload', id: id, name: name, mime: file.type, data: buf })
      })
    })
    return used
  }

  function uploaded(id, filename, error) {
    var rich = pending[id]
    delete pending[id]
    if (!rich) return
    var node = rich.querySelector('[data-pending="' + id + '"]')
    if (!node) return
    if (error) node.remove()
    else if (node.tagName === 'IMG') {
      URL.revokeObjectURL(node.src)
      node.removeAttribute('data-pending')
      node.setAttribute('src', filename)
    } else {
      node.replaceWith(document.createTextNode('[sound:' + filename + ']'))
    }
    rich.dispatchEvent(new Event('input'))
  }

  // Paste: files become media; text is pasted plain, so web styling doesn't
  // leak into her notes.
  document.addEventListener('paste', function (e) {
    var rich = fieldOf(e.target)
    if (!rich) return
    e.preventDefault()
    var data = e.clipboardData || window.clipboardData
    if (data.files && data.files.length && insertFiles(data.files, rich)) return
    document.execCommand('insertText', false, data.getData('text/plain'))
  })
  document.addEventListener('dragover', function (e) {
    if (fieldOf(e.target)) e.preventDefault()
  })
  document.addEventListener('drop', function (e) {
    var rich = fieldOf(e.target)
    if (!rich || !e.dataTransfer || !e.dataTransfer.files.length) return
    e.preventDefault()
    insertFiles(e.dataTransfer.files, rich)
  })

  // Cloze: wrap the selection in {{cN::…}} (N = next number; with Alt, the same number).
  var clozeMode = false
  function wrapCloze(same) {
    var rich = fieldOf(document.activeElement)
    if (!rich) return
    var max = 0
    document.querySelectorAll('.field__rich, .field__code').forEach(function (el) {
      var text = el.tagName === 'TEXTAREA' ? el.value : el.innerHTML
      var re = /\{\{c(\d+)::/g, m
      while ((m = re.exec(text))) max = Math.max(max, Number(m[1]))
    })
    var n = same ? Math.max(max, 1) : max + 1
    var sel = window.getSelection()
    var text = sel ? sel.toString() : ''
    document.execCommand('insertText', false, '{{c' + n + '::' + text + '}}')
    if (!text && sel && sel.focusNode) {
      // Put the caret inside the braces, ready to type.
      if (sel.modify) {
        sel.modify('move', 'backward', 'character')
        sel.modify('move', 'backward', 'character')
      }
    }
    rich.dispatchEvent(new Event('input'))
  }

  document.addEventListener('keydown', function (e) {
    if (clozeMode && (e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyC') {
      e.preventDefault()
      wrapCloze(e.altKey)
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      flushAndSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      post({ type: 'close' })
    }
  })

  // Send every field's current HTML (skipping the typing debounce), then "save".
  function flushAndSave() {
    Object.keys(timers).forEach(function (k) { clearTimeout(timers[k]) })
    document.querySelectorAll('.field').forEach(function (s) {
      var name = s.querySelector('.field__label').textContent
      var code = s.querySelector('.field__code')
      post({ type: 'field', name: name, html: code.hidden ? s.querySelector('.field__rich').innerHTML : code.value })
    })
    post({ type: 'save' })
  }

  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data) return
    var msg = e.data
    if (msg.type === 'load') build(msg.fields)
    else if (msg.type === 'uploaded') uploaded(msg.id, msg.filename, msg.error)
    else if (msg.type === 'flush') flushAndSave()
    else if (msg.type === 'mode') {
      clozeMode = !!msg.cloze
      var btn = document.querySelector('[data-cmd="cloze"]')
      if (btn) btn.hidden = !clozeMode
    }
    else if (msg.type === 'theme') {
      for (var k in msg.vars) document.documentElement.style.setProperty('--' + k, msg.vars[k])
      document.documentElement.style.colorScheme = msg.night ? 'dark' : 'light'
    }
  })

  post({ type: 'ready' })
})()
