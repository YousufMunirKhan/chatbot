# Your assistant — the owner's manual

Plain-English instructions for running your AI assistant. No technical knowledge assumed.

Written by tracing every step through the actual product on 7 September 2026. Where a
screen is hard to find, or a step will not work without help from a developer, this
guide says so instead of pretending otherwise.

---

## Before you start: how to find things

The menu down the left side of the screen does **not** yet list every screen you have.
Several of the features below are real and working, but the only way to open them today
is to type the address into your browser. Each section tells you the exact address.

The menu today shows: Home · Setup · Assistants · Website Widget · Inbox · Notifications
· Customers · Business Data · Quick Actions · Groups · Webhooks · Team & Settings.

A second, larger menu is being built. Until it arrives, keep this page open.

**Two screens act as hubs — learn these:**

| Hub | Address | What it leads to |
|---|---|---|
| Team & Settings | `/company/settings` | Team, Groups, Billing, Usage, Spending cap, Connected apps, Send data elsewhere, For developers, Reply-time targets, Inbox rules, Sign-in & security |
| Assistant settings | `/company/bots` → pick your assistant → Settings | Channels, Website widget, Business details |

---

## Your first 30 minutes

Do these five things in order. Everything else can wait.

**1. Make your assistant (5 min).**
Menu → **Setup**. It walks you through five steps. The first one asks whether this
assistant helps your customers or your own staff. Pick customers.

**2. Tell it about your business (10 min).**
Menu → **Business Data**. Fill in the basics tab, your services and prices, your
opening hours, and your usual answers (FAQs). This is the single biggest thing you can
do for answer quality. Your opening hours here are also used later for reply-time
promises, so get them right.

**3. Test it (5 min).**
Menu → **Website Widget**. The **Test your assistant** box sits at the top of that page.
Ask it three questions your customers actually ask. Check that it says "I don't know"
rather than making something up. If it guesses, go back to Business Data and add the
missing facts.

**4. Put it on your website (5 min).**
Same page, further down. Copy the one line of code shown under your assistant's name
and paste it into your website before the closing `</body>` tag. If someone else runs
your site, email them that line.

**5. Turn on the inbox (5 min).**
Menu → **Inbox**. This is where conversations the assistant could not finish land. Check
it daily. Menu → **Team & Settings** → **Team** to invite whoever will answer them.

**One thing to be aware of.** Any document you upload with the audience set to
"customer" or "both" is also published as a public web page at
`yoursite.com/help/<your assistant id>`. Nothing in the product tells you this. Do not
upload internal price lists, supplier terms or staff notes with that setting.

---

## "I want to answer customers on WhatsApp"

**What it does for you.** Customers message your business number and the assistant
answers instantly, day or night. Anything it cannot handle appears in your Inbox for a
person to pick up.

**What you need from Meta first.** This is the slow part, not the setup in our product.
Allow one to two weeks.

1. A Meta Business Account (`business.facebook.com`).
2. A developer app with the WhatsApp product added (`developers.facebook.com`).
3. **A phone number that is not already in use in the normal WhatsApp or WhatsApp
   Business phone app.** You cannot reuse your personal or shop number without first
   deleting it from the app.
4. From **WhatsApp → API setup**, two values: the **Phone number ID** (a long number)
   and a **permanent access token**.
5. Someone technical to paste our webhook address and verify token into Meta's console.
   This step cannot be done from our product.

**The click path.**

1. Go to `/company/channels` (or: Menu → Assistants → your assistant → Settings →
   **Channels**).
2. In **Connect a channel**, set Channel = **WhatsApp Business**.
3. Set Provider = **Meta WhatsApp Cloud API (direct)**.
4. Paste the Phone number ID into **WhatsApp phone number ID**.
5. Paste the token into **Permanent access token**.
6. Choose which assistant answers, then press **Connect channel**.
7. The page then shows a **Webhook** address and a **Verify token**. Send both to
   whoever manages your Meta app; they paste them into
   **Meta Business → WhatsApp → Configuration → Webhook** and tick the **messages** field.

There is a step-by-step guide on the same page under **How to connect WhatsApp**. Note
that the guide shows a placeholder address, `https://your-app-domain`. Ignore it — use
the real address shown in the box above it.

**A simpler alternative.** If Meta's process is too slow, set Provider = **Twilio (no
Meta verification)** instead. You give Twilio your business WhatsApp number and point
Twilio's "When a message comes in" setting at our address. Fewer approvals, but you pay
Twilio per message.

**How to check it worked.**

1. On `/company/channels`, find your channel in the list and press **Settings & test**.
2. Under **Send a test message**, enter a phone number in international format
   (`+14155551234`) and send. The message should arrive on that phone.
3. Then message your business number from a different phone. The reply should arrive,
   and the conversation should appear in Menu → **Inbox**.

**Known limitation, worth knowing now.** Today the assistant only reads **plain text**
messages on WhatsApp. If a customer sends a photo, a document, or taps a button, the
assistant does not see it and will not reply. Text-only conversations work fine.

---

## "I want to stop answering the same question 40 times a day"

You have three tools, from least to most effort.

### Business Data — the fastest fix

Menu → **Business Data**. Add the question and its answer under **FAQs**, or add the
underlying fact under services, prices or policies. The assistant uses these
immediately. No approval, no publishing step.

**How to check it worked.** Menu → **Website Widget** → **Test your assistant** → ask the
question in your own words. It should answer from what you just added.

### Chat buttons — for the top three questions

Menu → **Quick Actions**. These are the buttons a visitor sees the moment the chat opens
("Book a table", "Where are you?", "Opening hours"). Most people press a button rather
than type, so this cuts your repeat questions the fastest.

### Guided chats — for anything with more than one step

Use this when the answer depends on what the customer says: taking a booking, qualifying
a lead, running a menu. The assistant follows your script exactly, every time, and hands
anything off-script back to the AI.

**The click path.**

1. Go to `/company/flows`. There is no menu entry yet.
2. Scroll to **Start from a template** and pick one. Templates come wired end to end.
3. The editor opens. Click a block on the left to add it after the one you have
   selected. Drag a block to move it. Drag from the dot on a block's right edge to
   another block to connect them.
   *(The page says "Drag blocks onto the canvas" — that is wrong. You click them.)*
4. Open the **Triggers** panel and set what starts this chat: a keyword the customer
   types, a link they clicked, a Facebook ad, a comment on a post, the first message of a
   conversation, or a meaning the AI recognises.
5. Open the **Test** tab and talk to your own script. This runs the real thing, including
   changes you have not saved.
6. Press **Publish**. The product checks it for problems first and lists anything wrong.

**How to check it worked.** The badge at the top left must read **Live**, not **Draft**.
A **Draft** flow does nothing at all, and nothing else on the screen tells you so. Also
check the flow list shows a trigger — if it says *"No active trigger yet — this flow will
never start on its own"*, it will not run even when published.

**Avoid the "Custom event" trigger.** It can be configured but nothing in the product can
fire it yet.

---

## "I want to sell from Instagram and Facebook comments"

**What it does for you.** When someone comments on your post asking "how much?", the
assistant sends them a private message with the answer and leaves a short public reply
so other readers know it was handled.

**What you need from Meta first.** A Facebook Page, a Meta developer app, and a **Page
access token**. For Instagram you also need a professional (business) Instagram account
linked to that Page. Meta must approve your app for messaging permissions — allow two to
four weeks.

**The click path.**

1. `/company/channels` → Channel = **Facebook (Messenger + Feed)**.
2. Paste your **Facebook Page ID** and your **Page access token**. Press **Connect channel**.
3. Have your developer subscribe your Meta app to the **messages**, **messaging_postbacks**
   and **feed** fields, pointing at the webhook address shown on the page.
4. Find the connected channel in the list, press **Settings & test**, and open
   **Public comments**. Choose one of:
   - **Private DM + public acknowledgement** (the default)
   - **Public reply in the thread**
   - **Do not answer comments**
5. Edit the **Public acknowledgement** wording if you want.

**How to check it worked.** Comment on one of your own posts from a different account.
Within a minute you should get a direct message, and a short public reply should appear.

**Important — Instagram comments do not work yet.** The settings appear for Instagram and
you can save them, but comments on Instagram posts never reach the assistant. Instagram
**direct messages** do work. Facebook comments work properly. If selling from Instagram
comments is the goal, this is not ready.

**TikTok and YouTube.** Both are comment-reply only — there is no private messaging on
either. If you choose "Private DM + public acknowledgement" on these, you will silently
get a public reply instead. YouTube also needs a Google token that expires roughly every
hour and cannot renew itself, so it will stop working the same day you set it up. Treat
both as not ready.

---

## "I want to recover abandoned carts"

**What it does for you.** A shopper fills a basket and leaves. An hour or two later they
get a message with a link back to it.

**What you need from your shop first.**

- **Shopify.** This works. You need access to Settings → Notifications → Webhooks in
  your Shopify admin.
- **WooCommerce.** Abandoned carts are **not supported**. Order, shipping and
  cancellation messages work; cart recovery does not. The screen does not say this.

**The click path.**

1. First connect your shop: Menu → **Team & Settings** → **Connect your shop** → Shopify.
2. Then go to `/company/automations`. There is no link to this page anywhere in the
   product — you must type the address.
3. Under **Start with a proven automation**, press the **Abandoned cart** starter.
4. Set **Count a cart abandoned after (minutes)** — how quiet the basket must go. Default
   is 60.
5. Set **Wait before sending (minutes)** — how long after that before the message goes.
   The starter also sets this to 60, so out of the box you are waiting **two hours**, not
   the one hour the description claims. Set one of them to 0 if you want one hour total.
6. Write the message. Use the placeholder chips to drop in `{{recovery_url}}` and the
   customer's name.
7. Scroll to **Store webhook URLs**, press **Issue URL**, and copy the address shown.
8. In Shopify: Settings → Notifications → Webhooks → add a webhook for **checkouts/create**
   and another for **checkouts/update**, both pointing at that address.

While you are there, add these too for the other automations: `orders/paid`,
`orders/fulfilled`, `orders/partially_fulfilled`, `orders/cancelled`. The screen does not
list them.

**How to check it worked.** Add something to a basket on your own shop and abandon it.
Wait past both delays, then check `/company/automations` → **Recent runs**. Each attempt
shows its result and, if it failed, why.

**Before you rely on this, read the next section.** These messages are sent by a
scheduled job that has to be switched on at the server. If nobody has done that, nothing
sends and the screen still looks healthy.

---

## "I want to know if my team is replying fast enough"

**What it does for you.** You set a promise — "we answer WhatsApp within 15 minutes" —
and the product warns you before you break it, then records it if you do.

**The click path.**

1. First set your opening hours: Menu → **Business Data** → **Business hours**. The
   reply-time targets use these, but the targets screen does not mention them.
2. Menu → **Team & Settings** → **Reply-time targets** (address: `/company/sla`).
3. If the list is empty, press **Create starter policies**. That gives you three sensible
   rules to adjust.
4. To add your own, use **Add a policy**: name it, choose which urgency and which channel
   it covers (leave either on "Any" to make it the catch-all), set **First response
   target (minutes)**, and optionally a resolution target.
5. Set **Warn before breach (minutes)** so you get told before you miss it, and choose who
   to escalate to.
6. Tick **Only count business hours** if the clock should pause when you are closed.

**How to check it worked.** The four boxes at the top of the page fill in over the next
few days: **Attainment**, **Median first response**, **Breaches**, **At risk right now**.

**Three things to know.**

- These numbers only appear if a scheduled job is running on the server. See the next
  section. Without it, the page shows zeros forever and never says why.
- If your business is not on UK/GMT time, the "only count business hours" setting is
  currently offset by your timezone difference. A 9-to-5 shop in Dubai has its clock
  measured against 9-to-5 UTC.
- There is a second, older setting called **First-response SLA (minutes)** under
  Team & Settings → **Inbox rules**. That is the number the Inbox actually uses to colour
  its rows. The Reply-time targets screen and the Inbox are, for now, two separate
  systems. Set both.

---

## "I want to message all my customers at once"

**What it does for you.** One message to many people — a sale, a closure notice, a new
product.

**What you need first.** A connected WhatsApp channel, and for most sends an **approved
message template**. Meta only lets you send a free-form message to someone who messaged
you in the last 24 hours. Everyone else must receive an approved template.

**The click path.**

1. Create the template: `/company/whatsapp/templates`. Give it a name (lowercase and
   underscores only), pick a category — **Marketing** for promotions, **Utility** for
   order updates; Meta rejects promotions filed as Utility — write the body using `{{1}}`,
   `{{2}}` where values get filled in, and tick **Submit to Meta for approval now**.
2. Wait for Meta. Come back and press **Sync from Meta** to refresh the status. If it was
   rejected, the reason appears as "Meta said: …".
3. Go to `/company/broadcasts`. Choose your **Audience**: All leads, Opted-in contacts
   only, By conversation tag, By lead status, or A list I paste in. Anyone who has opted
   out is skipped whichever you pick.
4. Choose your approved template and fill in its values in order, separated by `|`.
5. Schedule and send.

**How to check it worked.** The broadcast row shows "*n* sent" and "*n* failed" once it
has run.

**Warnings.**

- **Do not press "Sync from Meta" on a template you wrote here.** It overwrites your own
  wording with the text `(managed in Meta)`. Only use Sync for templates you created
  inside Meta.
- The product will let you pick **"No template (session message only)"** and send it to
  everyone. Meta will reject most of those and repeated rejections damage your number's
  standing. Only use it for people who messaged you today.
- There is no send-rate control. If Meta has you on a low tier (shown as **Messaging
  limit** on `/company/whatsapp`), sending to a large list will produce a wall of
  failures.

---

## Things that must be switched on by whoever runs your server

This product has four background jobs. **None of them is scheduled automatically.** If
your developer or hosting provider has not set them up, the features below silently do
nothing — no error, no warning, no empty-state message.

| Job | How often | What stops working without it |
|---|---|---|
| `/api/cron/channels` | every 2–5 min | Gmail and YouTube never check for new messages |
| `/api/cron/sla` | every minute | No reply-time warnings, no breach records, all figures stay zero |
| `/api/cron/broadcasts` | every 5 min | No bulk message ever sends |
| `/api/cron/automations` | every 5 min | No order, shipping, cancellation or abandoned-cart message ever sends |

Each needs a password called `CRON_SECRET` set on the server.

**Ask your developer to confirm all four are scheduled before you promise any of this to
a customer.** The fastest check: set up an abandoned-cart automation, abandon a basket,
and see whether a run appears under `/company/automations` → **Recent runs** within ten
minutes. If nothing appears, the jobs are not running.

Separately, these need to be set on the server before the matching feature works at all,
and none of them is in the project's example configuration file:

| Setting | Needed for |
|---|---|
| `META_VERIFY_TOKEN` | Facebook and Instagram will refuse to save your webhook without it |
| `META_APP_SECRET` | Proves messages really came from Meta. Without it, anyone who learns your address can send fake customer messages |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | The "Connect Gmail" button |
| `EMAIL_API_URL` / `EMAIL_API_KEY` | Email replies. Without these the assistant reads mail but can never answer |
| `TIKTOK_CLIENT_SECRET` | Verifying TikTok messages |
| `ENCRYPTION_KEY` | Keeps your channel passwords safe in the database |

---

## The rest of the product, briefly

| I want to… | Where | Notes |
|---|---|---|
| See conversations needing a person | Menu → **Inbox** | Works well. Set up canned replies at `/company/inbox/canned` |
| See my leads, orders and bookings | Menu → **Customers** → "Manage all" on each card | |
| Ask customers to rate the reply | Automatic once a conversation closes; scores appear on Reports | |
| See where my chats come from | `/company/reports` | Real data. Ignore the "Completion rate" column on the flow table — it is calculated wrongly and will always look low |
| Upload files for it to learn from | Menu → **Business Data** → Knowledge tab | Remember these may be published publicly — see the warning at the top |
| Invite my team | Menu → **Team & Settings** → **Team** | You can only create agents. There is no way to make someone an admin from the interface |
| Name a set of staff or customers | Menu → **Groups** | You can create groups, but nothing uses them yet — you cannot broadcast to one or route work to one |
| Check my bill and top up | Menu → **Team & Settings** → **Billing** | See below |
| Stop the assistant if it costs too much | Menu → **Team & Settings** → **Spending cap** | |
| Switch the dashboard to Arabic | `/company/business-data` → **Default language** | Only about 8% of the dashboard is translated. Your *customers* get full Arabic — the assistant detects Arabic script and Arabizi and replies properly. Do not pick "Auto-detect" for the dashboard; it silently means English |
| Let a developer build on this | Menu → **Team & Settings** → **For developers** | Genuinely good. API keys with scopes, rate limits, a real JavaScript SDK, signed webhooks and a delivery log |

### About billing and "Automatic top-up"

The **Automatic top-up** section on the Billing page does not currently run
automatically. It only charges when you press **Top up now** yourself. Setting a
threshold and enabling the switch has no ongoing effect.

It also asks you to paste a Stripe payment method id that looks like `pm_1234…`. There is
no way to add a card from our screens — you or a developer must find that id in your
Stripe dashboard.

**Until this is fixed, check your credit balance manually.** It is shown as a small hint
under the "Top up below (credits)" field on the Billing page — that is the only place in
the product it appears. **When credit runs out the assistant stops answering** and tells
visitors it is "temporarily unavailable". You get no warning beforehand, and no email.

---

## What is not ready yet

Being straight with you, so you do not promise these to your own customers:

| Feature | Status |
|---|---|
| Instagram comment replies | Settings exist; comments never arrive |
| YouTube comments | Token expires within the hour and cannot renew |
| TikTok | Comment replies only, and "private DM" silently posts publicly |
| WhatsApp product cards / catalogue selling | The catalogue mapping screen works, but the assistant never sends product cards. The "Let the assistant send product cards" tick box does nothing |
| Abandoned carts on WooCommerce | Shopify only |
| Automatic credit top-up | Manual button only |
| Groups | Can be created; nothing consumes them |
| Contact opt-outs on store automations | **Broken.** Order and cart messages are sent to people who replied STOP. Do not enable store automations on WhatsApp until this is fixed |
| Arabic dashboard | ~8% translated. Arabic for your customers is complete |
| "AI insights" | Does not exist. The nearest thing is `/company/quality`, which suggests improvements from your own data |
