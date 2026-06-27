import { NextResponse } from 'next/server';
import { handleApiError } from '@/lib/errors';
import { createSupabaseServiceClient } from '@/lib/db/server';
import { getPlatformAiSettings, getPlatformEmailSettings } from '@/lib/platform-settings';

/**
 * Health check endpoint. Useful for Vercel/uptime monitors and to confirm the
 * deployment is live. GET /api/health
 */
export async function GET() {
  try {
    const sb = createSupabaseServiceClient();
    const [{ error: dbError }, ai, email, { count: jobBacklog }] = await Promise.all([
      sb.from('companies').select('id', { head: true, count: 'exact' }).limit(1),
      getPlatformAiSettings(),
      getPlatformEmailSettings(),
      sb.from('background_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    ]);
    return NextResponse.json({
      status: dbError ? 'degraded' : 'ok',
      service: 'ai-business-assistant',
      env: process.env.APP_ENV ?? 'development',
      checks: {
        database: dbError ? 'error' : 'ok',
        ai: Object.values(ai.keys).some(Boolean) ? 'configured' : 'missing_key',
        email: email.enabled ? 'enabled' : 'disabled',
        queuedJobs: jobBacklog ?? 0,
      },
      time: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
