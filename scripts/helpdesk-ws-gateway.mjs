import { config } from 'dotenv';
config({ path: '.env.local' });

import crypto from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.HELPDESK_WS_PORT || 8787);
const POLL_MS = Number(process.env.HELPDESK_WS_EVENT_INTERVAL_MS || 2000);

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function bearer(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function authenticate(req) {
  const token = bearer(req);
  if (!token) return null;
  const { rows } = await pool.query(
    `select id, company_id, platform, name, active_delivery_mode
     from public.helpdesk_connectors
     where token_hash = $1 and status = 'active'
     limit 1`,
    [tokenHash(token)],
  );
  return rows[0] || null;
}

async function logHealth(connector, eventType, status, message = null, metadata = {}) {
  await pool.query(
    `insert into public.helpdesk_connector_health_logs
      (company_id, connector_id, event_type, delivery_mode, status, message, metadata_json)
     values ($1,$2,$3,'websocket',$4,$5,$6)`,
    [connector.company_id, connector.id, eventType, status, message, metadata],
  ).catch(() => {});
}

async function updateState(connector, patch) {
  const fields = {
    active_delivery_mode: patch.activeDeliveryMode,
    connection_state: patch.connectionState,
    last_connected_at: patch.lastConnectedAt,
    last_disconnected_at: patch.lastDisconnectedAt,
    last_health_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    fallback_reason: patch.fallbackReason,
    last_error: patch.lastError,
  };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([key], index) => `${key} = $${index + 3}`).join(', ');
  await pool.query(
    `update public.helpdesk_connectors set ${sets} where company_id = $1 and id = $2`,
    [connector.company_id, connector.id, ...entries.map(([, value]) => value)],
  );
}

async function deliverQueuedEvents(connector, ws) {
  const { rows } = await pool.query(
    `update public.helpdesk_connector_events
     set status = 'running', claimed_at = now()
     where id in (
       select id from public.helpdesk_connector_events
       where connector_id = $1 and status = 'queued'
       order by created_at asc
       limit 10
       for update skip locked
     )
     returning id, event_name, request_json`,
    [connector.id],
  );
  if (!rows.length) return;
  ws.send(JSON.stringify({
    type: 'events',
    events: rows.map((row) => ({
      id: row.id,
      name: row.event_name,
      input: row.request_json || {},
    })),
  }));
  await logHealth(connector, 'event_delivered', 'success', null, { count: rows.length });
}

async function completeEvent(connector, message) {
  const status = message.status === 'completed' ? 'completed' : 'failed';
  await pool.query(
    `update public.helpdesk_connector_events
     set status = $1, response_json = $2, error_message = $3, completed_at = now()
     where id = $4 and connector_id = $5`,
    [status, message.response || null, message.error || null, message.eventId, connector.id],
  );
  await logHealth(
    connector,
    status === 'completed' ? 'event_completed' : 'event_failed',
    status === 'completed' ? 'success' : 'error',
    message.error || null,
    { eventId: message.eventId, durationMs: message.durationMs || null },
  );
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(426, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'websocket_required' }));
});

const wss = new WebSocketServer({ server, path: '/api/helpdesk/connectors/socket' });

wss.on('connection', async (ws, req) => {
  const connector = await authenticate(req).catch(() => null);
  if (!connector) {
    ws.close(1008, 'unauthorized_connector');
    return;
  }

  await updateState(connector, {
    activeDeliveryMode: 'websocket',
    connectionState: 'connected',
    lastConnectedAt: new Date().toISOString(),
    fallbackReason: null,
    lastError: null,
  });
  await logHealth(connector, 'websocket_connected', 'success');

  const timer = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
      deliverQueuedEvents(connector, ws).catch((error) => {
        logHealth(connector, 'event_delivered', 'error', error.message).catch(() => {});
      });
    }
  }, POLL_MS);

  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(String(raw));
      if (message.type === 'ack') {
        await logHealth(connector, 'event_acknowledged', 'success', null, { eventId: message.eventId });
      } else if (message.type === 'result') {
        await completeEvent(connector, message);
      } else if (message.type === 'hello') {
        await logHealth(connector, 'websocket_connected', 'success', 'Connector hello received.', message);
      } else if (message.type === 'pong') {
        await logHealth(connector, 'websocket_heartbeat', 'success');
      }
    } catch (error) {
      await logHealth(connector, 'event_failed', 'error', error.message);
    }
  });

  ws.on('close', async () => {
    clearInterval(timer);
    await updateState(connector, {
      activeDeliveryMode: 'polling_fallback',
      connectionState: 'fallback',
      lastDisconnectedAt: new Date().toISOString(),
      fallbackReason: 'websocket_closed',
    }).catch(() => {});
    await logHealth(connector, 'websocket_disconnected', 'info').catch(() => {});
  });

  ws.on('error', async (error) => {
    await updateState(connector, {
      activeDeliveryMode: 'polling_fallback',
      connectionState: 'fallback',
      lastError: error.message,
      fallbackReason: 'websocket_error',
    }).catch(() => {});
    await logHealth(connector, 'websocket_reconnect_failed', 'error', error.message).catch(() => {});
  });
});

server.listen(PORT, () => {
  console.log(`Help Desk WebSocket gateway listening on :${PORT}`);
  console.log(`Path: /api/helpdesk/connectors/socket`);
});
