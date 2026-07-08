// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = any

/**
 * Ensures the authenticated user has a profile row in the `profiles` table.
 * This is a client-side safety net for cases where the DB trigger
 * `handle_new_user` hasn't run yet (e.g. trigger not set up, or race condition).
 *
 * Safe to call multiple times — uses upsert with ON CONFLICT DO NOTHING semantics.
 */
export async function ensureProfile(supabase: AnySupabaseClient): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    // Check if profile already exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (existing) return true

    // Profile missing — create it from auth metadata
    const meta = user.user_metadata ?? {}
    const { error } = await supabase
      .from('profiles')
      .upsert(
        {
          id: user.id,
          full_name: meta.full_name ?? meta.name ?? '',
          phone: meta.phone ?? user.email?.split('@')[0] ?? '',
        },
        { onConflict: 'id' }
      )

    if (error) {
      console.error('[ensureProfile] Failed to create profile:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.error('[ensureProfile] Unexpected error:', err)
    return false
  }
}
