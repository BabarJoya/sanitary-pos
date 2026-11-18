import { Link } from 'react-router-dom'

// Friendly empty screen: what this page is for and the next step, with a button.
// action: { label, onClick } or { label, to } (in-app link); optional.
export default function EmptyState({ icon = '📭', title, text, action, secondary }) {
  const btn = (a, cls) => a.to
    ? <Link to={a.to} className={cls}>{a.label}</Link>
    : <button type="button" onClick={a.onClick} className={cls}>{a.label}</button>
  return (
    <div className="card mx-auto max-w-md px-6 py-10 text-center">
      <div className="text-4xl mb-3" aria-hidden="true">{icon}</div>
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      {text && <p className="mt-1 text-sm text-fg-muted">{text}</p>}
      {(action || secondary) && (
        <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
          {action && btn(action, 'btn btn-primary')}
          {secondary && btn(secondary, 'btn btn-secondary')}
        </div>
      )}
    </div>
  )
}
