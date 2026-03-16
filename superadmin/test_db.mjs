import { createClient } from '@supabase/supabase-js'

const url = 'https://flzcohjqlatscgdkkwmw.supabase.co'
const key = 'sb_secret_LjpVqQiMM8-6WqM5VydnaQ_bFViQYuK' // The user's service role key from .env

const supabaseAdmin = createClient(url, key)

async function check() {
  console.log('Fetching shops...')
  const { data: shops, error: shopErr } = await supabaseAdmin.from('shops').select('*, users(count)')
  if (shopErr) console.error('SHOP ERROR:', shopErr)
  console.log('SHOPS:', JSON.stringify(shops, null, 2))

  console.log('\nFetching users...')
  const { data: users, error: userErr } = await supabaseAdmin.from('users').select('*')
  if (userErr) console.error('USER ERROR:', userErr)
  console.log('USERS:', JSON.stringify(users, null, 2))
}

check()
