import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://flzcohjqlatscgdkkwmw.supabase.co'
const supabaseKey = 'sb_publishable_klPv8zgjHGaXWZp_6LZhig_6U-roC-a'

const supabase = createClient(supabaseUrl, supabaseKey)

async function testDelete() {
    const { data, error, status } = await supabase.from('products').delete().eq('id', 42) // dummy ID
    console.log('Data:', data)
    console.log('Error:', error)
    console.log('Status:', status)
}

testDelete()
