const ua = navigator.userAgent
/** iPhone/iPad report "Macintosh" in desktop mode; touch points tell them apart. */
export const isApple = /Mac|iPhone|iPad|iPod/.test(ua)
export const isTouch = window.matchMedia('(pointer: coarse)').matches
/** Label for the primary shortcut modifier. */
export const modKey = isApple ? '⌘' : 'Ctrl\u2009'
