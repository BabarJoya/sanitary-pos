import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://flzcohjqlatscgdkkwmw.supabase.co'
const supabaseKey = 'sb_publishable_klPv8zgjHGaXWZp_6LZhig_6U-roC-a'

export const supabase = createClient(supabaseUrl, supabaseKey)