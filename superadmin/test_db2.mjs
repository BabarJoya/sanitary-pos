import { createClient } from '@supabase/supabase-js'

const url = 'https://flzcohjqlatscgdkkwmw.supabase.co'
const key = 'sb_secret_LjpVqQiMM8-6WqM5VydnaQ_bFViQYuK'

const supabaseAdmin = createClient(url, key)

async function check() {
  const { data: shops } = await supabaseAdmin.from('shops').select('*').order('created_at', { ascending: false })
  
  // Get active user counts per shop
  const { data: userCounts } = await supabaseAdmin
    .from('users')
    .select('shop_id')
    .eq('is_active', true)
    
  const countMap = {}
  userCounts?.forEach(u => {
    countMap[u.shop_id] = (countMap[u.shop_id] || 0) + 1
  })
  
  const finalShops = shops.map(s => ({
    ...s,
    userCount: countMap[s.id] || 0
  }))

  console.log('FINAL SHOPS:', JSON.stringify(finalShops, null, 2))
}

check()
