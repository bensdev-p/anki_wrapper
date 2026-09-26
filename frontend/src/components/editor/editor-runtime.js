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

  // A field's HTML without the editor's own markers.
  function htmlOf(rich) {
    var sel = rich.querySelector('img.is-selected')
    if (!sel) return rich.innerHTML
    sel.classList.remove('is-selected')
    if (!sel.getAttribute('class')) sel.removeAttribute('class')
    var html = rich.innerHTML
    sel.classList.add('is-selected')
    return html
  }

  function build(fields) {
    hideBar()
    root.textContent = ''
    fields.forEach(function (f, i) {
      var section = el('section', 'field')
      var head = el('div', 'field__head')
      var label = el('label', 'field__label', f.name)
      var toggle = el('button', 'field__toggle', 'HTML')
      toggle.type = 'button'
      toggle.setAttribute('aria-pressed', 'false')
      toggle.title = 'Edit HTML source'
      var tools = el('div', 'field__tools')
      var pick = el('button', 'field__toggle field__image', 'Image')
      pick.type = 'button'
      pick.title = 'Add a picture from this device'
      var input = el('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = true
      input.hidden = true
      input.tabIndex = -1
      pick.addEventListener('click', function () { input.click() })
      input.addEventListener('change', function () {
        if (input.files && input.files.length) {
          if (!code.hidden) toggle.click() // back to the rich view first
          insertFiles(input.files, rich, true)
        }
        input.value = ''
      })
      tools.appendChild(pick)
      tools.appendChild(toggle)
      tools.appendChild(input)
      head.appendChild(label)
      head.appendChild(tools)

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

      rich.addEventListener('input', function () { report(f.name, htmlOf(rich)) })
      code.addEventListener('input', function () { report(f.name, code.value) })
      toggle.addEventListener('click', function () {
        var toCode = code.hidden
        if (toCode) {
          hideBar()
          code.value = htmlOf(rich)
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

  // Photos and screenshots are often several thousand pixels wide: far more
  // than a card shows, and slow to sync. Scale them down before saving.
  // GIFs (animated memes) and SVGs are kept as they are.
  var MAX_SIDE = 1600
  function shrink(file) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !window.createImageBitmap) return Promise.resolve(file)
    return createImageBitmap(file).then(function (bmp) {
      var scale = MAX_SIDE / Math.max(bmp.width, bmp.height)
      if (scale >= 1) { if (bmp.close) bmp.close(); return file }
      var canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
      if (bmp.close) bmp.close()
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob && blob.size < file.size ? blob : file) }, file.type, 0.88)
      })
    }).catch(function () { return file })
  }

  function insertFiles(files, rich, atEnd) {
    var used = false
    Array.prototype.forEach.call(files, function (file) {
      var ext = EXT[file.type]
      if (!ext) return
      used = true
      var id = 'u' + ++uploadSeq
      var base = file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.[^.]*$/, '') : 'paste-' + Date.now() + '-' + uploadSeq
      var name = base + '.' + ext
      var isSound = ext === 'mp3' || ext === 'm4a' || ext === 'ogg' || ext === 'wav'
      var html = isSound
        ? '<span data-pending="' + id + '">[sound:uploading…]</span>'
        : '<img data-pending="' + id + '" src="' + URL.createObjectURL(file) + '">'
      rich.focus()
      if (atEnd || !fieldOf(window.getSelection() && window.getSelection().anchorNode)) {
        // From the Image button: add below what's there (the caret may be elsewhere).
        var range = document.createRange()
        range.selectNodeContents(rich)
        range.collapse(false)
        var sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(range)
        if (rich.textContent.trim() || rich.querySelector('img')) html = '<br>' + html
      }
      document.execCommand('insertHTML', false, html)
      pending[id] = rich
      ;(isSound ? Promise.resolve(file) : shrink(file)).then(function (blob) {
        return blob.arrayBuffer()
      }).then(function (buf) {
        post({ type: 'upload', id: id, name: name, mime: file.type, data: buf })
      })
    })
    return used
  }

  // Pictures copied as part of a web page arrive as HTML. Embedded (data:)
  // images can be saved; linked ones can't be fetched from here.
  function imagesFromHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html')
    var files = []
    var linked = 0
    doc.querySelectorAll('img').forEach(function (img) {
      var src = img.getAttribute('src') || ''
      var m = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(src)
      if (m && EXT[m[1]]) {
        var bin = atob(m[2])
        var bytes = new Uint8Array(bin.length)
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        files.push(new File([bytes], 'image.' + EXT[m[1]], { type: m[1] }))
      } else if (src) linked++
    })
    return { files: files, linked: linked }
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
  // leak into the note.
  document.addEventListener('paste', function (e) {
    var rich = fieldOf(e.target)
    if (!rich) return
    e.preventDefault()
    var data = e.clipboardData || window.clipboardData
    if (data.files && data.files.length && insertFiles(data.files, rich)) return
    var text = data.getData('text/plain')
    var html = data.getData('text/html')
    if (html && /<img/i.test(html)) {
      var found = imagesFromHtml(html)
      if (text.trim()) document.execCommand('insertText', false, text)
      if (found.files.length) insertFiles(found.files, rich)
      else if (found.linked) post({ type: 'notice', text: 'That picture is a link to a website, so it can’t be pasted. Right-click the picture itself and choose “Copy Image”, or save it and use the Image button.' })
      return
    }
    document.execCommand('insertText', false, text)
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

  // Click a picture to size it: small, medium, full width, or remove it.
  // Sizes are max-widths, so a small picture never gets blown up.
  var SIZES = [['S', 'Small', 200], ['M', 'Medium', 400], ['L', 'Full width', 0]]
  var bar = el('div', 'imgbar')
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Picture size')
  bar.hidden = true
  var current = null
  SIZES.forEach(function (s) {
    var b = el('button', null, s[0])
    b.type = 'button'
    b.title = s[1]
    b.dataset.size = String(s[2])
    bar.appendChild(b)
  })
  var del = el('button', 'imgbar__remove', 'Remove')
  del.type = 'button'
  del.dataset.size = 'remove'
  bar.appendChild(del)
  document.body.appendChild(bar)

  function sizeOf(img) {
    var w = parseInt(img.style.maxWidth, 10)
    return isNaN(w) ? 0 : w
  }
  function showBar(img) {
    current = img
    var r = img.getBoundingClientRect()
    bar.hidden = false
    bar.style.top = Math.max(r.top + window.scrollY + 6, window.scrollY + 48) + 'px'
    bar.style.left = r.left + window.scrollX + 6 + 'px'
    var size = sizeOf(img)
    bar.querySelectorAll('button[data-size]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.size === String(size)))
    })
    img.classList.add('is-selected')
  }
  function hideBar() {
    if (current) {
      current.classList.remove('is-selected')
      if (!current.getAttribute('class')) current.removeAttribute('class')
    }
    current = null
    bar.hidden = true
  }
  bar.addEventListener('mousedown', function (e) { e.preventDefault() })
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button')
    if (!b || !current) return
    var rich = fieldOf(current)
    if (b.dataset.size === 'remove') {
      current.remove()
      hideBar()
    } else {
      var px = Number(b.dataset.size)
      if (px) current.style.maxWidth = px + 'px'
      else current.style.removeProperty('max-width')
      if (!current.getAttribute('style')) current.removeAttribute('style')
      showBar(current)
    }
    if (rich) rich.dispatchEvent(new Event('input'))
  })
  document.addEventListener('click', function (e) {
    var img = e.target.closest && e.target.closest('.field__rich img')
    if (img) showBar(img)
    else if (!bar.contains(e.target)) hideBar()
  })
  document.addEventListener('keydown', function () { if (current) hideBar() }, true)
  window.addEventListener('resize', hideBar)

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
      post({ type: 'field', name: name, html: code.hidden ? htmlOf(s.querySelector('.field__rich')) : code.value })
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
