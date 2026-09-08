import { getSessionUser } from '@/lib/auth';
import {
  formatSecretForDisplay,
  getCompanyTwoFactorPolicy,
  getUserTwoFactorState,
  totpQrSvg,
  totpUri,
  TWO_FACTOR_POLICY_OFF,
  type CompanyTwoFactorPolicy,
  type TwoFactorMethod,
} from '@/lib/auth/two-factor';
import { ROLES } from '@/lib/constants';
import { createSupabaseServiceClient } from '@/lib/db/server';

export interface MySecuritySettings {
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  recentEvents: Array<{ id: string; eventType: string; createdAt: string; ip: string | null }>;
}

export async function getMySecuritySettings(): Promise<MySecuritySettings> {
  const user = await getSessionUser();
  if (!user) return { twoFactorEnabled: false, lastLoginAt: null, recentEvents: [] };
  const sb = createSupabaseServiceClient();
  const [{ data: settings }, { data: events }] = await Promise.all([
    sb.from('user_security_settings').select('two_factor_enabled,last_login_at').eq('user_id', user.userId).maybeSingle(),
    sb
      .from('security_audit_logs')
      .select('id,event_type,created_at,ip_address')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  return {
    twoFactorEnabled: Boolean(settings?.two_factor_enabled),
    lastLoginAt: (settings?.last_login_at as string) ?? null,
    recentEvents: (events ?? []).map((event) => ({
      id: event.id as string,
      eventType: event.event_type as string,
      createdAt: event.created_at as string,
      ip: (event.ip_address as string) ?? null,
    })),
  };
}

/**
 * What the QR code is offering, while an enrolment is half-finished.
 *
 * The raw secret is deliberately NOT here. Everything on this object crosses to
 * a client component and therefore into the page's HTML, so it carries only the
 * two forms a person actually uses: the symbol they scan, the grouped text they
 * type when they cannot, and the link that opens their app directly on a phone.
 */
export interface TwoFactorEnrolmentOffer {
  /** Grouped in fours, for typing into the app by hand. */
  secretForDisplay: string;
  /** `otpauth://` — a tap on a phone hands this straight to the app. */
  uri: string;
  qrSvg: string;
}

export interface TwoFactorPanel {
  /** `off` — nothing set up. `pending` — scanned, not yet proved. `on` — live. */
  status: 'off' | 'pending' | 'on';
  method: TwoFactorMethod | null;
  confirmedAt: string | null;
  recoveryCodesRemaining: number;
  enrolment: TwoFactorEnrolmentOffer | null;
  policy: CompanyTwoFactorPolicy;
  /** Only a company admin may change the policy for everybody else. */
  canManagePolicy: boolean;
  accountEmail: string;
  companyName: string;
}

/**
 * Everything the security page and the forced-enrolment page both need.
 *
 * Deliberately `skipTwoFactorCheck` — the session check may be the very thing
 * that sent the user here, and a data function that re-runs it would bounce the
 * request in a loop. Nothing below is sensitive to that: the user id still comes
 * from the auth cookie, not from anything the caller passed in.
 */
export async function getTwoFactorPanel(): Promise<TwoFactorPanel | null> {
  const user = await getSessionUser({ skipTwoFactorCheck: true });
  if (!user) return null;

  const sb = createSupabaseServiceClient();
  const [state, policy, companyRow, recoveryCount] = await Promise.all([
    getUserTwoFactorState(user.userId),
    user.companyId ? getCompanyTwoFactorPolicy(user.companyId, { fresh: true }) : Promise.resolve(TWO_FACTOR_POLICY_OFF),
    user.companyId
      ? sb.from('companies').select('name').eq('id', user.companyId).maybeSingle()
      : Promise.resolve({ data: null }),
    sb
      .from('user_recovery_codes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .is('used_at', null),
  ]);

  const companyName = ((companyRow.data as { name?: string } | null)?.name ?? '').trim();
  // The issuer is what the person will see in their authenticator app's list.
  // Their own company's name is far more recognisable there than ours would be,
  // because that is the account they think they are protecting.
  const issuer = companyName || 'Business Assistant';

  let enrolment: TwoFactorEnrolmentOffer | null = null;
  if (!state.enabled && state.pendingSecret) {
    const uri = totpUri({ secret: state.pendingSecret, account: user.email, issuer });
    enrolment = {
      secretForDisplay: formatSecretForDisplay(state.pendingSecret),
      uri,
      qrSvg: totpQrSvg(uri),
    };
  }

  return {
    status: state.enabled ? 'on' : enrolment ? 'pending' : 'off',
    method: state.method,
    confirmedAt: state.confirmedAt,
    recoveryCodesRemaining: recoveryCount.count ?? 0,
    enrolment,
    policy,
    canManagePolicy: user.role === ROLES.COMPANY_ADMIN,
    accountEmail: user.email,
    companyName: issuer,
  };
}

export interface TeamTwoFactorSummary {
  total: number;
  enrolled: number;
}

/**
 * How many of the company's people already hold a second factor.
 *
 * The number on the admin's screen before they switch the policy on, because
 * "this will affect 6 of your 8 people" is the sentence that stops somebody
 * locking out their own team on a Friday afternoon.
 */
export async function getTeamTwoFactorSummary(companyId: string): Promise<TeamTwoFactorSummary> {
  const sb = createSupabaseServiceClient();
  const { data: members } = await sb
    .from('company_users')
    .select('user_id')
    .eq('company_id', companyId);
  const ids = (members ?? []).map((row) => row.user_id as string);
  if (ids.length === 0) return { total: 0, enrolled: 0 };

  const { data: enrolled } = await sb
    .from('user_security_settings')
    .select('user_id')
    .in('user_id', ids)
    .eq('two_factor_enabled', true);

  return { total: ids.length, enrolled: (enrolled ?? []).length };
}
