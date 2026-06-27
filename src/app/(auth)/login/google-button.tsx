'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/db/client';
import { Button } from '@/components/ui/button';

/**
 * Optional Google sign-in (Module 3 — "Google login optional"). Works only if
 * the Google provider is enabled in Supabase → Authentication → Providers, and
 * `${origin}/auth/callback` is added to the allowed redirect URLs.
 */
export function GoogleButton() {
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="w-full" onClick={onClick}>
        Continue with Google
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
