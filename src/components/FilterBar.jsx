// ============================================================================
// Sticky search / filter bar for long lists (Products, Inventory, Sales,
// Customers). Stays at the top of the page while scrolling (Layout's <main> is
// the scroll container) and shows "Showing X of Y" with a Clear filters chip.
//   <FilterBar shown={list.length} total={all.length} noun="products"
//              active={!!search || !!category} onClear={reset}> …inputs… </FilterBar>
// ============================================================================

export default function FilterBar({ children, shown, total, noun = 'items', active = false, onClear, className = '' }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-2 bg-app/90 backdrop-blur-sm">
      <div className={`bg-surface p-3 sm:p-4 rounded-xl shadow-sm border border-line-subtle ${className}`}>
        {children}
      </div>
      {total > 0 && (
        <div className="flex items-center justify-between gap-2 mt-1.5 px-1 min-h-8 text-xs text-fg-muted" aria-live="polite">
          <span>
            {active
              ? <>Showing <b className="text-fg-2">{shown}</b> of {total} {noun}</>
              : <>{total} {noun}</>}
          </span>
          {active && onClear && (
            <button type="button" onClick={onClear}
              className="inline-flex items-center gap-1 min-h-8 px-3 rounded-full border border-primary-line bg-primary-soft text-primary-strong font-bold hover:bg-primary-muted">
              ✕ Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}
