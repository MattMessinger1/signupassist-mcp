import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../integrations/supabase/client'

export default function AuthPage() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} />
    </div>
  )
}