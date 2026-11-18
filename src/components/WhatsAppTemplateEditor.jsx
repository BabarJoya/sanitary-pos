import { useRef } from 'react'
import { WA_TEMPLATES, templateFor, fillTemplate } from '../utils/whatsapp'

// One WhatsApp template in Settings: text box, clickable placeholders (inserted
// at the cursor), a live preview with sample values, and "Use default".
export default function WhatsAppTemplateEditor({ kind, value, onChange }) {
  const t = WA_TEMPLATES[kind]
  const ref = useRef(null)
  const current = templateFor(kind, { [t.key]: value })
  const isDefault = current === t.default

  const insert = (name) => {
    const el = ref.current
    const token = `[${name}]`
    if (!el) { onChange(current + token); return }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    onChange(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) })
  }

  return (
    <div className="rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-bold text-fg">{t.label}</h4>
          <p className="text-xs text-fg-muted">{t.hint}</p>
        </div>
        <button type="button" disabled={isDefault} onClick={() => onChange(t.default)} className="btn btn-ghost btn-sm shrink-0 disabled:opacity-40">
          {isDefault ? 'Using default' : 'Use default'}
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`wa-tpl-${kind}`} className="text-xs font-bold text-fg-3">Message</label>
          <textarea id={`wa-tpl-${kind}`} ref={ref} value={current} onChange={e => onChange(e.target.value)} rows={10}
            className="input w-full mt-1 font-mono text-xs leading-relaxed" />
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Insert a placeholder">
            {t.placeholders.map(p => (
              <button key={p} type="button" onClick={() => insert(p)} className="px-2 py-1 rounded-md border border-line bg-surface-2 text-[11px] font-mono text-primary-fg hover:bg-primary-soft">
                [{p}]
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-bold text-fg-3">Preview (sample)</p>
          <div className="mt-1 rounded-xl bg-[#e5ddd5] p-3 min-h-40">
            <div className="ml-auto max-w-[95%] rounded-lg bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-[#111] whitespace-pre-wrap shadow-sm">
              {fillTemplate(current, t.sample)}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">Lines with an empty value (for example no balance or no link) are left out when sending. *text* shows bold in WhatsApp.</p>
        </div>
      </div>
    </div>
  )
}
