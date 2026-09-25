const ua = navigator.userAgent
/** iPhone/iPad report "Macintosh" in desktop mode; touch points tell them apart. */
export const isApple = /Mac|iPhone|iPad|iPod/.test(ua)
export const isTouch = window.matchMedia('(pointer: coarse)').matches
/** Label for the primary shortcut modifier. */
export const modKey = isApple ? '⌘' : 'Ctrl\u2009'

interface DesktopApi {
  open_external(url: string): Promise<void>
}
declare global {
  interface Window {
    pywebview?: { api?: DesktopApi }
  }
}

/** Running inside the Rounds desktop window (pywebview), not a browser. */
export const inDesktopWindow = () => !!window.pywebview?.api

/** Open an http(s) link in the user's browser (a new tab, or the system browser in the desktop app). */
export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return
  const api = window.pywebview?.api
  if (api) void api.open_external(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}
