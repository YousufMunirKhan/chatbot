#!/usr/bin/env bash
#
# Deploy this app to the server it is already running on.
#
#   sudo bash scripts/deploy.sh                 # show what it WOULD do
#   sudo bash scripts/deploy.sh --apply         # actually deploy
#   sudo bash scripts/deploy.sh --apply --ref feat/competitor-parity
#   sudo bash scripts/deploy.sh --apply --install-cron   # ...and write the crons
#
# The server hosts more than one application (nginx also serves "Retail
# Backoffice"), so this script refuses to touch anything it has not positively
# identified as THIS app, and it never edits nginx.
#
# What it does, in order:
#   1. Find the app directory and the thing that runs it (pm2 / systemd).
#   2. Record the current commit so a rollback is one command.
#   3. Fetch and check out the requested ref.
#   4. Install dependencies and build. If the build fails, nothing is restarted
#      — the old build keeps serving.
#   5. Swap the new build in and restart.
#   6. Show the crontab block the scheduled jobs need — or install it, with
#      --install-cron. Nothing on this box reads vercel.json.
#   7. Poll /api/health until it answers or time runs out, and if it never comes
#      back, roll the checkout back and restart again.
set -uo pipefail

REF="feat/competitor-parity"
APPLY=0
INSTALL_CRON=0
HEALTH_URL="${HEALTH_URL:-https://chatbot.ssepos.co.uk/api/health}"

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --install-cron) INSTALL_CRON=1 ;;
    --ref) REF="${2:?--ref needs a branch or tag}"; shift ;;
    --health) HEALTH_URL="${2:?--health needs a URL}"; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

# The scheduled jobs hit the same origin the health check does, so one flag
# moves both rather than leaving a hardcoded hostname in the cron lines to go
# stale the first time this is deployed anywhere else.
BASE_URL="${HEALTH_URL%/api/health}"

say() { printf '%s\n' "$*"; }
run() {
  if [ "$APPLY" -eq 1 ]; then
    say "  \$ $*"
    "$@" || return 1
  else
    say "  would run: $*"
  fi
}

# --- 1. Find the app -------------------------------------------------------
say "== Finding the application =="
APP_DIR=""
for base in /var/www /opt /srv /home /root; do
  [ -d "$base" ] || continue
  while IFS= read -r pkg; do
    if grep -q '"name": *"ai-business-assistant"' "$pkg" 2>/dev/null; then
      APP_DIR="$(dirname "$pkg")"
      break 2
    fi
  done < <(find "$base" -maxdepth 4 -name package.json -not -path '*/node_modules/*' 2>/dev/null)
done

if [ -z "$APP_DIR" ]; then
  say "Could not find a directory whose package.json is \"ai-business-assistant\"."
  say "Pass it explicitly:  APP_DIR=/path/to/app sudo bash scripts/deploy.sh --apply"
  [ -n "${APP_DIR_OVERRIDE:-}" ] && APP_DIR="$APP_DIR_OVERRIDE" || exit 1
fi
say "  app directory: $APP_DIR"
cd "$APP_DIR" || exit 1

if [ ! -d .git ]; then
  say "  $APP_DIR is not a git checkout — this script cannot update it safely."
  exit 1
fi

CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null)"
say "  current commit: ${CURRENT_COMMIT:0:12}"
say "  rollback later with:  cd $APP_DIR && git checkout $CURRENT_COMMIT && <restart command>"

# --- 2. Find what runs it --------------------------------------------------
say ""
say "== Finding how it is run =="
RESTART=""
if command -v pm2 >/dev/null 2>&1 && pm2 jlist 2>/dev/null | grep -q '"name"'; then
  PM2_NAME="$(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)"
  if [ -n "$PM2_NAME" ]; then
    RESTART="pm2 restart $PM2_NAME --update-env"
    say "  pm2 process: $PM2_NAME"
  fi
fi
if [ -z "$RESTART" ]; then
  UNIT="$(systemctl list-units --type=service --no-legend 2>/dev/null \
          | awk '{print $1}' | grep -iE 'chatbot|assistant|next' | head -1)"
  if [ -n "$UNIT" ]; then
    RESTART="systemctl restart $UNIT"
    say "  systemd unit: $UNIT"
  fi
fi
if [ -z "$RESTART" ]; then
  say "  Could not identify pm2 or a systemd unit. Set it yourself:"
  say "    RESTART_CMD='pm2 restart chatbot' sudo bash scripts/deploy.sh --apply"
  RESTART="${RESTART_CMD:-}"
  [ -z "$RESTART" ] && exit 1
fi

# --- 3. Update the code ----------------------------------------------------
say ""
say "== Updating to $REF =="
DIRTY="$(git status --porcelain | head -5)"
if [ -n "$DIRTY" ]; then
  say "  WARNING: uncommitted changes on the server:"
  printf '    %s\n' "$DIRTY"
  say "  They will be kept (no reset). Commit or stash them if that is wrong."
fi
run git fetch --all --prune || { say "fetch failed"; exit 1; }
run git checkout "$REF" || { say "checkout failed"; exit 1; }
run git pull --ff-only origin "$REF" || say "  (no fast-forward pull — detached or already current)"

# --- 4. Install and build --------------------------------------------------
say ""
say "== Installing and building =="
if [ -f package-lock.json ]; then
  run npm ci --omit=dev --no-audit --no-fund || run npm ci --no-audit --no-fund || { say "install failed"; exit 1; }
else
  run npm install --no-audit --no-fund || { say "install failed"; exit 1; }
fi

# Next needs devDependencies to build, so install them if `--omit=dev` ran.
run npm install --no-audit --no-fund >/dev/null 2>&1

# Build somewhere else, then swap it in.
#
# Building straight into `.next` overwrites the chunks and manifests the running
# server is still reading from, so every page the live site rendered during a
# build returned 500. That is not theoretical: two deploys in one evening each
# produced a minute of 500s, and the person using the site reported two
# different pages as broken. `next.config.mjs` reads NEXT_DIST_DIR, so the build
# goes to `.next-build` and only becomes live at the `mv`, which is one
# filesystem operation.
BUILD_DIR=.next-build
run rm -rf "$BUILD_DIR"

# Drop the previous build's generated route types before compiling.
#
# `tsconfig.json` includes both `.next/types` and `.next-build/types`, so a
# build reads the route declarations of the build that is still serving. When a
# route is renamed or removed, those stale declarations point at files that no
# longer exist and the compile fails on the old build's types rather than the
# new build's code — which is exactly what happened the first time a route was
# renamed. They are build-time declarations only; the running server does not
# read them, so removing them cannot disturb what is being served.
run rm -rf .next/types

if ! NEXT_DIST_DIR="$BUILD_DIR" run npm run build; then
  say ""
  say "BUILD FAILED — nothing was swapped or restarted, the old build is still serving."
  say "Fix the error, then run this script again."
  run rm -rf "$BUILD_DIR"
  exit 1
fi

# --- 5. Swap and restart ---------------------------------------------------
say ""
say "== Swapping the new build in =="
run rm -rf .next-previous
if [ -d .next ]; then
  run mv .next .next-previous || { say "could not move the old build aside"; exit 1; }
fi
run mv "$BUILD_DIR" .next || {
  say "SWAP FAILED — restoring the previous build."
  [ -d .next-previous ] && mv .next-previous .next
  exit 1
}

say ""
say "== Restarting =="
run bash -c "$RESTART" || { say "restart command failed"; exit 1; }

# --- 6. Scheduled jobs -----------------------------------------------------
#
# WHY THE CRONTAB IS THE ONLY PLACE THIS COUNTS
# ---------------------------------------------
# `vercel.json` lists these same jobs and this server never reads it — nothing
# here is deployed through Vercel. A scheduling change that goes only into that
# file is dead on arrival, and one already was: it sat there for weeks looking
# like it had shipped. So the schedule lives here, next to the deploy that
# installs it.
#
# WHY THE BILLING LINE IS A LOOP AND NOT A CURL
# ---------------------------------------------
# /api/cron/billing sweeps every active company for monthly credit and usage
# warnings. It cannot finish an unbounded list inside one request, so it works
# through the company list in id order until its time budget is spent and then
# hands back where it got to on an `X-Next-Cursor` header. Nothing ever passed
# that back: the old line here was a bare curl, so every run restarted at the
# first company and — once there were more than one run's worth — the tail of
# the list would never be replenished and never warned, silently. The loop below
# is what chases the cursor: it re-calls with `?after=<cursor>` until the header
# comes back empty. `flock` keeps a slow walk from being overlapped by the next
# tick, and the iteration cap stops a bad cursor spinning forever.
#
# The secret is read out of the app's own .env at RUN time rather than written
# into the crontab, so rotating CRON_SECRET does not mean re-installing cron,
# and the secret exists in one file instead of two. The extractor matches how
# the app parses that file (scripts/check-env.mjs): KEY=value, unquoted.
say ""
say "== Scheduled jobs =="
CRON_ENV_FILE="$APP_DIR/.env.production"
CRON_BEGIN="# >>> ai-business-assistant cron (managed by scripts/deploy.sh) >>>"
CRON_END="# <<< ai-business-assistant cron <<<"
SECRET_SH="s=\$(grep -m1 \"^CRON_SECRET=\" $CRON_ENV_FILE | cut -d= -f2-)"

if command -v flock >/dev/null 2>&1; then
  LOCK="flock -n /tmp/ai-business-assistant-billing.lock "
else
  LOCK=""
  say "  NOTE: flock is not installed, so a slow billing walk can overlap the next"
  say "        tick. Harmless (every job in the sweep is idempotent) but wasteful."
fi

# One self-contained line per job: cron gives each command a bare /bin/sh with
# no environment, so nothing can be shared between them.
job() { # schedule, path
  printf '%s bash -c \x27%s; curl -fsS -m 60 -H "Authorization: Bearer $s" "%s%s" >/dev/null\x27\n' \
    "$1" "$SECRET_SH" "$BASE_URL" "$2"
}

cron_block() {
  printf '%s\n' "$CRON_BEGIN"
  printf '%s\n' "# Managed block. Edit scripts/deploy.sh, not this: --install-cron replaces"
  printf '%s\n' "# everything between the markers and leaves the rest of the crontab alone."
  job "* * * * *"    "/api/cron/sla"
  job "*/2 * * * *"  "/api/cron/channels"
  job "*/5 * * * *"  "/api/cron/automations"
  job "*/5 * * * *"  "/api/cron/broadcasts"
  job "*/5 * * * *"  "/api/cron/snooze"
  job "0 3 * * *"    "/api/cron/retention"
  job "0 6 * * 1"    "/api/cron/insights"
  # The billing walker. 40 calls is far more than ten thousand companies needs
  # (one call already covers thousands); it is a stop, not a target.
  printf '%s\n' "*/15 * * * * ${LOCK}bash -c '$SECRET_SH; c=\"\"; for i in \$(seq 1 40); do h=\$(curl -fsS -m 120 -D - -o /dev/null -H \"Authorization: Bearer \$s\" \"$BASE_URL/api/cron/billing?after=\$c\") || break; c=\$(echo \"\$h\" | tr -d \"\\r\" | grep -i \"^x-next-cursor:\" | cut -d\" \" -f2); [ -n \"\$c\" ] || break; done'"
  printf '%s\n' "$CRON_END"
}

if [ "$INSTALL_CRON" -eq 1 ] && [ "$APPLY" -eq 1 ]; then
  if ! command -v crontab >/dev/null 2>&1; then
    say "  crontab is not installed — cannot schedule anything. Install cron first."
  else
    CRON_NOW="$(crontab -l 2>/dev/null || true)"
    BACKUP="/root/crontab-before-deploy-$(date +%Y%m%d-%H%M%S).txt"
    printf '%s\n' "$CRON_NOW" > "$BACKUP" 2>/dev/null && say "  previous crontab saved to $BACKUP"

    # Anything outside the markers is somebody else's — this box also runs
    # "Retail Backoffice" — so it is copied through untouched. Only the managed
    # block is replaced.
    KEPT="$(printf '%s\n' "$CRON_NOW" | awk -v b="$CRON_BEGIN" -v e="$CRON_END" \
      '$0==b{skip=1; next} $0==e{skip=0; next} skip==0{print}')"

    # A line the operator pasted by hand from an older version of this script
    # would double-schedule the job. Never deleted — that is their crontab — but
    # said out loud, because a leftover bare billing curl is exactly the thing
    # that restarts the sweep at the first company every 15 minutes.
    STRAY="$(printf '%s\n' "$KEPT" | grep -n '/api/cron/' || true)"
    if [ -n "$STRAY" ]; then
      say "  WARNING: crontab lines outside the managed block also call /api/cron/:"
      printf '    %s\n' "$STRAY"
      say "  They were kept. Delete them with 'crontab -e' or these jobs run twice."
    fi

    { printf '%s\n' "$KEPT"; cron_block; } | grep -v '^$' | crontab - \
      && say "  installed $(cron_block | grep -c 'curl') scheduled jobs" \
      || say "  FAILED to install the crontab — the backup above is still valid."
  fi
else
  say "  Not installing (needs --apply --install-cron). This is the block it writes,"
  say "  and 'crontab -e' takes it as-is:"
  say ""
  cron_block | sed 's/^/    /'
  say ""
  say "  Every job needs CRON_SECRET in $CRON_ENV_FILE. Without it the header is"
  say "  sent empty, the endpoints answer 401, and nothing scheduled ever runs."
fi

if [ "$APPLY" -eq 0 ]; then
  say ""
  say "Dry run finished. Nothing was changed. Re-run with --apply."
  exit 0
fi

# --- 7. Health check and rollback ------------------------------------------
# The crontab above is installed before this point on purpose: it only names
# URLs, so it is correct for the rolled-back build too, and leaving the box with
# no schedule because a health check flapped would be the worse failure.
say ""
say "== Waiting for $HEALTH_URL =="
HEALTHY=0
for i in $(seq 1 30); do
  sleep 2
  BODY="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"
  if printf '%s' "$BODY" | grep -q '"status":"ok"'; then
    say "  healthy after $((i * 2))s: $BODY"
    HEALTHY=1
    break
  fi
done

if [ "$HEALTHY" -ne 1 ]; then
  say ""
  say "  NOT healthy after 60s. Rolling back to ${CURRENT_COMMIT:0:12}."
  git checkout "$CURRENT_COMMIT"
  # The build that was serving a minute ago is still on disk, so put it back
  # rather than spending another minute rebuilding it while the site is down.
  if [ -d .next-previous ]; then
    rm -rf .next && mv .next-previous .next
    say "  Restored the previous build without rebuilding."
  else
    say "  No previous build kept — rebuilding, this takes a minute."
    npm run build
  fi
  bash -c "$RESTART"
  say "  Rolled back. Check the service logs for the cause."
  exit 1
fi

say ""
say "== Done =="
say "Deployed $REF to $APP_DIR."
say ""
say "These features stay OFF until the settings exist in the server's environment:"
say "  CRON_SECRET            broadcasts, order + cart messages, reply-time warnings, Gmail/YouTube polling, auto top-up"
say "  META_APP_SECRET        WhatsApp / Messenger / Instagram webhooks are REFUSED in production without it"
say "  META_VERIFY_TOKEN      needed to save the webhook in Meta's dashboard"
say "  EMAIL_API_URL/_KEY     replying to email (reading it already works)"
say "  VAPID_* keys           phone alerts for the dashboard"
say "  SHOPIFY_WEBHOOK_SECRET / WOOCOMMERCE_WEBHOOK_SECRET   store order automations"
say ""
say "The cron list in vercel.json does NOT run here — this box is not on Vercel."
say "The scheduled jobs are the crontab block printed above; add or refresh it with:"
say "  sudo bash scripts/deploy.sh --apply --install-cron"
say "Editing vercel.json changes nothing on this server. It has been mistaken for"
say "a shipped change before."
