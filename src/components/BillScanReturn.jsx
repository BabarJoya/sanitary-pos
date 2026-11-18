import { useEffect, useRef, useState } from 'react'
import { Modal } from './ui'
import { parseBillCode } from '../utils/billCode'
import toast from '../utils/toast'

// ============================================================================
// "Return by bill": scan the bill's QR with a scanner (it types the link and
// presses Enter), use the phone camera (where the browser can read QR codes),
// or type the invoice number. Calls onCode({ token } | { number }).
// ============================================================================

const cameraSupported = () => typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

export default function BillScanReturn({ open, onClose, onCode, busy }) {
  const [text, setText] = useState('')
  const [camera, setCamera] = useState(false)
  const videoRef = useRef(null)

  useEffect(() => { if (!open) { setText(''); setCamera(false) } }, [open])

  // Camera scanning with the browser's built-in QR reader
  useEffect(() => {
    if (!camera) return
    let stream, timer, stopped = false
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (stopped) return
        const v = videoRef.current
        v.srcObject = stream
        await v.play()
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        const tick = async () => {
          if (stopped) return
          try {
            const found = await detector.detect(v)
            const value = found?.[0]?.rawValue
            const code = value && parseBillCode(value)
            if (code) { setCamera(false); onCode(code); return }
          } catch { /* frame not ready */ }
          timer = setTimeout(tick, 250)
        }
        tick()
      } catch {
        toast.warning('Camera not available — use a scanner or type the bill number.')
        setCamera(false)
      }
    }
    start()
    return () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [camera, onCode])

  const submit = (e) => {
    e.preventDefault()
    const code = parseBillCode(text)
    if (!code) { toast.warning('Scan the QR on the bill, or type the invoice number.'); return }
    onCode(code)
  }

  return (
    <Modal open={open} onClose={onClose} title="↩️ Return by bill" subtitle="Scan the QR on the customer's bill — the bill opens with its return boxes" maxWidth="max-w-sm" dismissible={false}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label">Scan QR or type invoice number</span>
          <input className="input w-full font-mono" autoFocus value={text} onChange={e => setText(e.target.value)}
            placeholder="e.g. 12345678" autoComplete="off" inputMode="text" />
        </label>
        <button type="submit" className="btn btn-primary w-full min-h-11" disabled={busy}>{busy ? 'Finding bill…' : 'Find bill'}</button>
        {cameraSupported() && (
          camera ? (
            <div className="space-y-2">
              <video ref={videoRef} className="w-full rounded-xl bg-black aspect-square object-cover" muted playsInline aria-label="Camera view" />
              <button type="button" className="btn btn-secondary w-full" onClick={() => setCamera(false)}>Stop camera</button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary w-full min-h-11" onClick={() => setCamera(true)}>📷 Scan with camera</button>
          )
        )}
      </form>
    </Modal>
  )
}
