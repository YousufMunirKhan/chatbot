# Deployment Checklist

Live domain:

```text
https://chatbot.ssepos.co.uk
```

Use this order to deploy safely. The safest approach is to deploy the normal Next.js app first, confirm the customer bot still works, then enable the Help Desk WebSocket gateway.

## 1. Go To Project Folder

```bash
cd /path/to/your/chatbot/project
```

## 2. Pull Latest Code

```bash
git pull
```

## 3. Install Dependencies

This is needed because the Help Desk WebSocket gateway uses the `ws` package.

```bash
npm install
```

## 4. Check Live Environment

Make sure live `.env` has:

```bash
NEXT_PUBLIC_APP_URL=https://chatbot.ssepos.co.uk
DATABASE_URL=your_live_database_url
```

## 5. Run Database Migrations

```bash
npm run db:migrate
```

This applies any missing migrations, including Help Desk chat visibility settings.

## 6. Run Quick Action Seeder Once

```bash
npm run seed:quick-actions
```

This safely adds missing default customer/helpdesk pills. It does not overwrite edited existing pills.

## 7. Build The App

```bash
npm run build
```

## 8. Restart Existing App

First find the PM2 app name:

```bash
pm2 list
```

Then restart the correct app, for example:

```bash
pm2 restart chatbot
```

Check logs:

```bash
pm2 logs chatbot
```

## 9. Test Before WebSocket

Open:

```text
https://chatbot.ssepos.co.uk/company/help-desk
```

Check:

```text
Help Desk page opens
Staff Help Desk Chat appears
Quick pills appear
Connector monitoring appears
Customer website bot still opens normally
```

At this point, Help Desk can still work with polling fallback even without WebSocket.

## 10. Start Help Desk WebSocket Gateway

Run this only after the normal app is working.

```bash
pm2 start scripts/helpdesk-ws-gateway.mjs --name helpdesk-ws
pm2 save
```

Check logs:

```bash
pm2 logs helpdesk-ws
```

Expected:

```text
Help Desk WebSocket gateway listening on :8787
```

## 11. Add Nginx WebSocket Proxy

Add this before the normal Next.js proxy block:

```nginx
location /api/helpdesk/connectors/socket {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;
    proxy_read_timeout 3600;
}
```

Then reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 12. Final Live Checks

Open:

```text
https://chatbot.ssepos.co.uk/company/help-desk
```

Check:

```text
Help Desk chat works
Visibility rules save
Connector logs appear
Customer public bot still works
```

## Rollback Notes

If WebSocket has any issue:

```bash
pm2 stop helpdesk-ws
```

The connector will use polling fallback.

If the Next.js app has any issue, roll back to the previous deployed code and restart:

```bash
git checkout previous_good_commit
npm install
npm run build
pm2 restart chatbot
```

## Important

Customer bot safety is protected by audience filtering:

```text
Customer bot sees customer-safe pills/docs/tools only.
Help Desk bot sees internal connector docs/actions/pills.
```

Do not expose connector tokens on public customer pages.
