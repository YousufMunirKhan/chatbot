# Live Environment Setup

`.env.production` is intentionally ignored by Git because it contains live secrets.

Git will include:

- `.env.production.example`
- `scripts/check-env.mjs`

Git will not include:

- `.env.production`
- `.env.local`

## On The Live Server

From the project root:

```bash
cp .env.production.example .env.production
nano .env.production
```

Fill these required values:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Confirm the live URLs stay:

```text
NEXT_PUBLIC_APP_URL=https://chatbot.ssepos.co.uk
NEXT_PUBLIC_WIDGET_URL=https://chatbot.ssepos.co.uk/widget/widget.js
APP_ENV=production
```

Then run:

```bash
npm install
npm run env:check:production
npm run build
npm run start
```

## Supabase Redirect URL

Add this in Supabase Auth redirect URLs:

```text
https://chatbot.ssepos.co.uk/auth/callback
```

## If You Want To Upload The Real Env File

Upload `.env.production` manually with SFTP/SCP or your hosting file manager.
Do not use Git for the real env file.
