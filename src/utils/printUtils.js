/**
 * printUtils.js — Mobile-safe print helper
 *
 * Uses a hidden <iframe> injected into the current page instead of
 * window.open('', '_blank'). This bypasses mobile browser popup-blockers
 * (iOS Safari, Android Chrome) which block blank popups triggered by JS.
 *
 * Usage:  import { printHTML } from '../utils/printUtils'
 *         printHTML(myHtmlString)
 */

export function printHTML(html) {
  // Re-use an existing frame if present, otherwise create one
  let frame = document.getElementById('__pos_print_frame')
  if (!frame) {
    frame = document.createElement('iframe')
    frame.id = '__pos_print_frame'
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText =
      'position:fixed;width:1px;height:1px;border:0;left:-9999px;top:-9999px;opacity:0;pointer-events:none;'
    document.body.appendChild(frame)
  }

  const doc = frame.contentWindow.document
  doc.open()
  doc.write(html)
  doc.close()

  // Wait for images to load before printing
  const win = frame.contentWindow
  const doprint = () => {
    try { win.focus(); win.print() } catch (_) {}
  }

  const imgs = doc.images
  if (!imgs || imgs.length === 0) {
    setTimeout(doprint, 400)
    return
  }

  let loaded = 0
  const onLoad = () => { if (++loaded >= imgs.length) setTimeout(doprint, 300) }
  for (let i = 0; i < imgs.length; i++) {
    if (imgs[i].complete) onLoad()
    else { imgs[i].onload = onLoad; imgs[i].onerror = onLoad }
  }
}
