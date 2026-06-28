import { config } from 'dotenv';
import dns from 'node:dns/promises';
import pg from 'pg';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL || DATABASE_URL.includes('[YOUR-PASSWORD]')) {
  console.error('DATABASE_URL is not set in .env.local.');
  process.exit(1);
}

async function buildClient() {
  const u = new URL(DATABASE_URL);
  let host = u.hostname;
  try {
    await dns.lookup(host);
  } catch {
    try {
      const a6 = await dns.resolve6(host);
      if (a6[0]) host = a6[0];
    } catch {
      const a4 = await dns.resolve4(host).catch(() => []);
      if (a4[0]) host = a4[0];
    }
  }
  return new pg.Client({
    host,
    port: Number(u.port) || 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1) || 'postgres',
    ssl: { rejectUnauthorized: false },
  });
}

async function timeQuery(client, label, sql, params = []) {
  const start = performance.now();
  const result = await client.query(sql, params);
  const ms = Math.round(performance.now() - start);
  return { label, ms, rows: result.rowCount };
}

async function explain(client, label, sql, params = []) {
  const result = await client.query(`explain (analyze, buffers, format json) ${sql}`, params);
  const plan = result.rows[0]['QUERY PLAN'][0];
  return {
    label,
    executionMs: Number(plan['Execution Time'].toFixed(2)),
    planningMs: Number(plan['Planning Time'].toFixed(2)),
    topNode: plan.Plan['Node Type'],
    planRows: plan.Plan['Plan Rows'],
    actualRows: plan.Plan['Actual Rows'],
  };
}

async function main() {
  const url = new URL(DATABASE_URL);
  const client = await buildClient();
  await client.connect();

  const roundTrips = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await client.query('select 1');
    roundTrips.push(Math.round(performance.now() - start));
  }

  const companies = await client.query('select id, name from public.companies order by created_at desc limit 1');
  const companyId = companies.rows[0]?.id ?? null;
  const companyName = companies.rows[0]?.name ?? null;

  const timings = [];
  timings.push(await timeQuery(client, 'companies list base', 'select id,name,status,created_at from public.companies order by created_at desc limit 100'));
  timings.push(await timeQuery(client, 'monthly AI cost grouped', "select company_id, sum(estimated_cost) from public.ai_usage_logs where created_at >= date_trunc('month', now()) group by company_id"));
  timings.push(await timeQuery(client, 'audit logs latest', 'select id, action, created_at from public.audit_logs order by created_at desc limit 150'));
  timings.push(await timeQuery(client, 'admin access latest', 'select id, action, created_at from public.admin_access_logs order by created_at desc limit 150'));

  if (companyId) {
    timings.push(await timeQuery(client, 'company inbox list', 'select id,status,channel,last_message_at from public.conversations where company_id = $1 order by last_message_at desc limit 100', [companyId]));
    timings.push(await timeQuery(client, 'company quality logs', "select id,question,auto_audit_status,created_at from public.answer_quality_logs where company_id = $1 and created_at >= now() - interval '30 days' order by created_at desc limit 500", [companyId]));
  }

  const dashboardQueryTimings = [];
  if (companyId) {
    const pageQueries = [
      ['company: profile + subscription', 'select c.id,c.name,c.status,c.created_at,s.plan,s.status as sub_status from public.companies c left join public.subscriptions s on s.company_id = c.id where c.id = $1', [companyId]],
      ['company: bots list', 'select * from public.bots where company_id = $1 order by created_at desc', [companyId]],
      ['company: members list', 'select cu.id,cu.user_id,cu.role,u.email,u.full_name from public.company_users cu left join public.users u on u.id = cu.user_id where cu.company_id = $1 order by cu.created_at asc', [companyId]],
      ['company: agent presence', 'select user_id,status from public.agent_presence where company_id = $1', [companyId]],
      ['company: active conversations count', "select count(*) from public.conversations where company_id = $1 and status <> 'closed'", [companyId]],
      ['company: leads count', 'select count(*) from public.leads where company_id = $1', [companyId]],
      ['company: appointments count', 'select count(*) from public.appointments where company_id = $1', [companyId]],
      ['company: chat orders count', 'select count(*) from public.chat_orders where company_id = $1', [companyId]],
      ['company: synced orders count', 'select count(*) from public.synced_orders where company_id = $1', [companyId]],
      ['setup: business profile', 'select * from public.company_business_profiles where company_id = $1', [companyId]],
      ['setup: locations', 'select * from public.company_locations where company_id = $1 order by is_primary desc', [companyId]],
      ['setup: business hours', 'select * from public.company_business_hours where company_id = $1 and location_id is null order by day_of_week asc', [companyId]],
      ['setup: policies', 'select id,title,category,content,created_at from public.company_policies where company_id = $1 and is_active = true order by created_at desc', [companyId]],
      ['setup: services', 'select * from public.company_services where company_id = $1 and is_active = true order by created_at desc', [companyId]],
      ['setup: faqs', 'select id,question,answer,category from public.company_faqs where company_id = $1 and is_active = true order by created_at desc', [companyId]],
      ['setup: documents list', 'select id,title,source_type,status,char_count,bot_id,created_at from public.documents where company_id = $1 order by created_at desc', [companyId]],
      ['setup: synced_products count', 'select count(*) from public.synced_products where company_id = $1', [companyId]],
      ['setup: synced_orders count', 'select count(*) from public.synced_orders where company_id = $1', [companyId]],
      ['setup: synced_customers count', 'select count(*) from public.synced_customers where company_id = $1', [companyId]],
      ['setup: menu_items count', 'select count(*) from public.restaurant_menu_items where company_id = $1', [companyId]],
      ['quality: setup suggestions profile', 'select short_description,primary_phone,support_email,whatsapp from public.company_business_profiles where company_id = $1', [companyId]],
      ['quality: answer metrics 30d', "select id,question,estimated_cost,failure_reason,auto_audit_status,created_at,latency_ms,handoff_status from public.answer_quality_logs where company_id = $1 and created_at >= now() - interval '30 days' order by created_at desc limit 500", [companyId]],
      ['quality: recent answer display rows', "select id,question,answer,model,estimated_cost,failure_reason,auto_audit_status,auto_audit_label,auto_audit_score,auto_audit_reason,suggested_fix,source_types,created_at from public.answer_quality_logs where company_id = $1 and created_at >= now() - interval '30 days' order by created_at desc limit 25", [companyId]],
      ['quality: index summary rpc', 'select * from public.company_quality_index_summary($1)', [companyId]],
      ['quality: fixes list', 'select id,quality_log_id,status,correction_text,metadata_json,created_at from public.answer_quality_feedback where company_id = $1 order by created_at desc limit 12', [companyId]],
      ['quality: eval questions', 'select id,question,language from public.eval_questions where company_id = $1 order by created_at desc', [companyId]],
    ];
    for (const [label, sql, params] of pageQueries) {
      dashboardQueryTimings.push(await timeQuery(client, label, sql, params));
    }

    const superCompanyQueries = [
      ['super: companies base', 'select id,name,status,created_at from public.companies order by created_at desc limit 100', []],
      ['super: company subscription', 'select plan,status,free_until,message_limit from public.subscriptions where company_id = $1', [companyId]],
      ['super: company monthly message count', "select count(*) from public.ai_usage_logs where company_id = $1 and operation_type = 'chat' and created_at >= date_trunc('month', now())", [companyId]],
      ['super: company active reply grants', "select id,reply_count,reason,grant_type,expires_at,created_at from public.company_reply_grants where company_id = $1 and (expires_at is null or expires_at >= now()) order by created_at desc", [companyId]],
      ['super: company monthly ai cost', "select estimated_cost from public.ai_usage_logs where company_id = $1 and created_at >= date_trunc('month', now())", [companyId]],
      ['super: company credit account', 'select balance_amount,lifetime_usage_charged from public.company_credit_accounts where company_id = $1', [companyId]],
      ['super: company whatsapp settings', 'select whatsapp_enabled,whatsapp_sender_mode,whatsapp_provider from public.company_notification_settings where company_id = $1', [companyId]],
    ];
    for (const [label, sql, params] of superCompanyQueries) {
      dashboardQueryTimings.push(await timeQuery(client, label, sql, params));
    }
  }

  const plans = [];
  if (companyId) {
    plans.push(await explain(client, 'inbox plan', 'select id,status,channel,last_message_at from public.conversations where company_id = $1 order by last_message_at desc limit 100', [companyId]));
    plans.push(await explain(client, 'quality plan', "select id,question,auto_audit_status,created_at from public.answer_quality_logs where company_id = $1 and created_at >= now() - interval '30 days' order by created_at desc limit 500", [companyId]));
  }

  const tableStats = await client.query(`
    select relname, n_live_tup::bigint as estimated_rows
    from pg_stat_user_tables
    where schemaname = 'public'
      and relname in ('companies','conversations','messages','answer_quality_logs','ai_usage_logs','audit_logs','admin_access_logs')
    order by relname
  `);

  const report = {
    databaseHost: url.hostname,
    testedCompany: companyId ? { id: companyId, name: companyName } : null,
    roundTripsMs: roundTrips,
    avgRoundTripMs: Math.round(roundTrips.reduce((sum, n) => sum + n, 0) / roundTrips.length),
    timings,
    dashboardQueryTimings,
    slowestDashboardQueries: [...dashboardQueryTimings].sort((a, b) => b.ms - a.ms).slice(0, 12),
    plans,
    tableStats: tableStats.rows,
  };

  console.log(JSON.stringify(report, null, 2));
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
