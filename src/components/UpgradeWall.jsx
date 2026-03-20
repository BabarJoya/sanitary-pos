import { getPlanName } from '../utils/featureGate'

const PLAN_ORDER = ['Trial', 'Basic', 'Gold', 'Unlimited']
const FEATURE_UNLOCK_PLAN = {
  brands:          'Basic',
  suppliers:       'Basic',
  purchases:       'Basic',
  customer_ledger: 'Basic',
  reports:         'Basic',
  data_export:     'Basic',
  offline_sync:    'Basic',
  expenses:        'Gold',
  supplier_ledger: 'Gold',
  trash_bin:       'Gold',
  bulk_import:     'Gold',
  audit_logs:      'Gold',
  advanced_reports:'Gold',
  whatsapp:        'Unlimited',
  api_access:      'Unlimited',
}

export default function UpgradeWall({ feature }) {
  const currentPlan = getPlanName()
  const requiredPlan = FEATURE_UNLOCK_PLAN[feature] || 'a higher plan'
  const currentIndex = PLAN_ORDER.indexOf(currentPlan)
  const requiredIndex = PLAN_ORDER.indexOf(requiredPlan)
  const plansToShow = currentIndex >= 0
    ? PLAN_ORDER.slice(currentIndex + 1, requiredIndex + 1)
    : [requiredPlan]

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">🔒</span>
        </div>
        <h2 className="text-2xl font-black text-gray-800 mb-2">Feature Locked</h2>
        <p className="text-gray-500 mb-4">
          This feature is not available on the{' '}
          <span className="font-bold text-gray-700">{currentPlan}</span> plan.
        </p>
        {requiredPlan !== 'a higher plan' && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 text-left">
            <p className="text-xs font-black text-blue-400 uppercase tracking-widest mb-2">Unlocks in</p>
            <div className="flex gap-2 flex-wrap">
              {plansToShow.map(p => (
                <span key={p} className="px-3 py-1 bg-blue-600 text-white text-sm font-bold rounded-full">
                  {p} Plan
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
          <p className="text-sm font-bold text-gray-600">Contact support to upgrade your plan</p>
          <p className="text-lg font-black text-gray-800 mt-1">📞 0301-2616367</p>
        </div>
      </div>
    </div>
  )
}
