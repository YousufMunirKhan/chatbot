/**
 * Channel adapter unit tests — no network, no database, no dev server.
 *
 * Every messaging surface funnels through two pure functions per adapter:
 * `parse()` (provider payload → normalised InboundEvent) and the block→message
 * mapping used by `send()`. Those are exactly the places a provider quirk
 * silently breaks a tenant's inbox, and they are testable offline, so this
 * script imports the real adapter modules (see scripts/lib/ts-loader.mjs) and
 * drives them with realistic payloads.
 *
 * Run: node scripts/test-channels.mjs
 */
import './lib/ts-loader.mjs';
import crypto from 'node:crypto';

const A = '../src/lib/channels/adapters';
const { telegramAdapter } = await import(`${A}/telegram.ts`);
const { viberAdapter } = await import(`${A}/viber.ts`);
const { lineAdapter } = await import(`${A}/line.ts`);
const { facebookAdapter, instagramAdapter } = await import(`${A}/meta.ts`);
const { whatsappAdapter, whatsappMessages } = await import(`${A}/whatsapp.ts`);

let failures = 0;
let group = '';
const section = (name) => {
  group = name;
  console.log(`\n— ${name}`);
};
const check = (label, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`);
  if (!cond) {
    failures++;
    if (detail !== undefined) console.log('   got:', JSON.stringify(detail));
    if (group) console.log(`   in: ${group}`);
  }
};

const ctx = (queryIdentity = null, headers = new Headers()) => ({ queryIdentity, headers });

// ---------------------------------------------------------------- Telegram --
section('Telegram parse');
{
  const message = {
    update_id: 8901,
    message: {
      message_id: 42,
      from: { id: 500100, first_name: 'Amina', last_name: 'Haddad', username: 'amina_h' },
      chat: { id: 500100, type: 'private' },
      date: 1717171717,
      text: '  Do you deliver to Doha?  ',
    },
  };
  const events = telegramAdapter.parse(message, ctx('7788990'));
  check('one event from a plain message', events.length === 1, events.length);
  check('external id comes from ?id=', events[0]?.externalId === '7788990', events[0]?.externalId);
  check('sender is the chat id', events[0]?.from === '500100', events[0]?.from);
  check('text is trimmed', events[0]?.text === 'Do you deliver to Doha?', events[0]?.text);
  check('sender name is joined', events[0]?.fromName === 'Amina Haddad', events[0]?.fromName);
  check('message id is carried for dedupe', events[0]?.messageId === '42', events[0]?.messageId);
  check('kind is message', events[0]?.kind === 'message', events[0]?.kind);

  const callback = {
    update_id: 8902,
    callback_query: {
      id: 'cbq-1',
      from: { id: 500100, first_name: 'Amina' },
      message: { message_id: 43, chat: { id: 500100 } },
      data: 'book_appointment',
    },
  };
  const tapped = telegramAdapter.parse(callback, ctx('7788990'));
  check('callback_query becomes one event', tapped.length === 1, tapped.length);
  check('button payload becomes the text', tapped[0]?.text === 'book_appointment', tapped[0]?.text);
  check('callback ids are namespaced', tapped[0]?.messageId === 'cb:cbq-1', tapped[0]?.messageId);
  check('callback replies to the chat, not the callback', tapped[0]?.from === '500100', tapped[0]?.from);

  check('no ?id= means no events (never guess the tenant)', telegramAdapter.parse(message, ctx(null)).length === 0);
  check('a status-only update is ignored', telegramAdapter.parse({ update_id: 1 }, ctx('7788990')).length === 0);
}

// ------------------------------------------------------------------- Viber --
section('Viber parse');
{
  const payload = {
    event: 'message',
    timestamp: 1717171717,
    message_token: 5098765432100,
    sender: { id: 'viber-user-01', name: 'Yusuf' },
    message: { type: 'text', text: 'What time do you close?' },
    context: 'campaign-spring',
  };
  const events = viberAdapter.parse(payload, ctx('viber-pa-1'));
  check('one event from a message callback', events.length === 1, events.length);
  check('external id comes from ?id=', events[0]?.externalId === 'viber-pa-1', events[0]?.externalId);
  check('sender id is preserved', events[0]?.from === 'viber-user-01', events[0]?.from);
  check('message token is the dedupe id', events[0]?.messageId === '5098765432100', events[0]?.messageId);
  check('context becomes the referral', events[0]?.referral === 'campaign-spring', events[0]?.referral);
  check(
    'delivery receipts are ignored',
    viberAdapter.parse({ ...payload, event: 'delivered' }, ctx('viber-pa-1')).length === 0,
  );
}

// -------------------------------------------------------------------- LINE --
section('LINE parse');
{
  const payload = {
    destination: 'Uad0987654321fedcba',
    events: [
      {
        type: 'message',
        webhookEventId: 'wh-1',
        replyToken: 'reply-token-1',
        source: { type: 'user', userId: 'U1111111111' },
        message: { id: 'msg-1', type: 'text', text: ' Is delivery free? ' },
      },
      {
        type: 'postback',
        webhookEventId: 'wh-2',
        replyToken: 'reply-token-2',
        source: { type: 'user', userId: 'U2222222222' },
        postback: { data: 'plan=premium' },
      },
      // Follows carry no conversational content.
      { type: 'follow', source: { type: 'user', userId: 'U3333333333' }, replyToken: 'rt-3' },
    ],
  };
  const events = lineAdapter.parse(payload, ctx(null));
  check('message + postback parse, follow is dropped', events.length === 2, events.length);
  check('external id comes from destination, not the URL', events[0]?.externalId === 'Uad0987654321fedcba', events[0]?.externalId);
  check('text is trimmed', events[0]?.text === 'Is delivery free?', events[0]?.text);
  check('reply token is carried (free replies)', events[0]?.replyToken === 'reply-token-1', events[0]?.replyToken);
  check('postback data becomes the text', events[1]?.text === 'plan=premium', events[1]?.text);
  check('postback uses the webhook event id', events[1]?.messageId === 'wh-2', events[1]?.messageId);
}

// ---------------------------------------------------------------- Facebook --
section('Facebook parse');
{
  const messaging = {
    object: 'page',
    entry: [
      {
        id: '109876543210',
        time: 1717171717,
        messaging: [
          {
            sender: { id: 'PSID-1' },
            recipient: { id: '109876543210' },
            message: { mid: 'mid.1', text: 'Hello, are you open today?' },
          },
          // Our own outbound message echoed back — replying to it would loop.
          {
            sender: { id: '109876543210' },
            recipient: { id: 'PSID-1' },
            message: { mid: 'mid.echo', text: 'We are open until 8pm', is_echo: true },
          },
        ],
      },
    ],
  };
  const events = facebookAdapter.parse(messaging, ctx(null));
  check('one event, the echo is dropped', events.length === 1, events.length);
  check('page id is the external id', events[0]?.externalId === '109876543210', events[0]?.externalId);
  check('PSID is the sender', events[0]?.from === 'PSID-1', events[0]?.from);

  const postback = {
    object: 'page',
    entry: [
      {
        id: '109876543210',
        messaging: [
          {
            sender: { id: 'PSID-2' },
            recipient: { id: '109876543210' },
            postback: {
              mid: 'mid.pb',
              title: 'Get started',
              payload: 'GET_STARTED',
              referral: { ref: 'promo-42', source: 'ADS' },
            },
          },
        ],
      },
    ],
  };
  const pb = facebookAdapter.parse(postback, ctx(null));
  check('postback becomes a message event', pb.length === 1 && pb[0].kind === 'message', pb[0]?.kind);
  check('postback payload becomes the text', pb[0]?.text === 'GET_STARTED', pb[0]?.text);
  check('referral ref is captured', pb[0]?.referral === 'promo-42', pb[0]?.referral);

  const feed = {
    object: 'page',
    entry: [
      {
        id: '109876543210',
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: '109876543210_555',
              post_id: '109876543210_111',
              from: { id: 'fb-user-9', name: 'Layla' },
              message: 'How much is shipping to Riyadh?',
            },
          },
          // Likes and edits are not conversations.
          { field: 'feed', value: { item: 'like', verb: 'add', post_id: '109876543210_111' } },
          { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'x', message: 'edited' } },
        ],
      },
    ],
  };
  const comments = facebookAdapter.parse(feed, ctx(null));
  check('only the new comment parses', comments.length === 1, comments.length);
  check('comment is kind=comment', comments[0]?.kind === 'comment', comments[0]?.kind);
  check('comment id is carried', comments[0]?.commentId === '109876543210_555', comments[0]?.commentId);
  check('post id is carried', comments[0]?.postId === '109876543210_111', comments[0]?.postId);
  check('commenter name is captured', comments[0]?.fromName === 'Layla', comments[0]?.fromName);

  const ownComment = {
    object: 'page',
    entry: [
      {
        id: '109876543210',
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: '109876543210_777',
              from: { id: '109876543210', name: 'Our Page' },
              message: 'Thanks for reaching out!',
            },
          },
        ],
      },
    ],
  };
  check('the page never answers its own comment', facebookAdapter.parse(ownComment, ctx(null)).length === 0);
}

// --------------------------------------------------------------- Instagram --
section('Instagram parse');
{
  const payload = {
    object: 'instagram',
    entry: [
      {
        id: '17841400000000000',
        changes: [
          {
            field: 'comments',
            value: {
              id: 'ig-comment-1',
              from: { id: 'ig-user-3', username: 'sara.codes' },
              media: { id: 'ig-media-7' },
              text: 'Do you ship internationally?',
            },
          },
        ],
      },
    ],
  };
  const events = instagramAdapter.parse(payload, ctx(null));
  check('IG comment parses', events.length === 1, events.length);
  check('kind is comment', events[0]?.kind === 'comment', events[0]?.kind);
  check('comment id falls back to value.id', events[0]?.commentId === 'ig-comment-1', events[0]?.commentId);
  check('media id becomes the post id', events[0]?.postId === 'ig-media-7', events[0]?.postId);
  check('username becomes the display name', events[0]?.fromName === 'sara.codes', events[0]?.fromName);
  check(
    'a feed-field change is ignored on Instagram',
    instagramAdapter.parse(
      { entry: [{ id: '178414', changes: [{ field: 'feed', value: { message: 'x', comment_id: 'y' } }] }] },
      ctx(null),
    ).length === 0,
  );
}

// ---------------------------------------------------------------- WhatsApp --
section('WhatsApp parse');
{
  const text = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: '1029384756' },
              contacts: [{ profile: { name: 'Omar' }, wa_id: '966500000000' }],
              messages: [
                { from: '966500000000', id: 'wamid.TEXT', timestamp: '1717171717', type: 'text', text: { body: 'Hi there' } },
              ],
            },
          },
        ],
      },
    ],
  };
  const events = whatsappAdapter.parse(text, ctx(null));
  check('text message parses', events.length === 1, events.length);
  check('phone_number_id is the external id', events[0]?.externalId === '1029384756', events[0]?.externalId);
  check('profile name is captured', events[0]?.fromName === 'Omar', events[0]?.fromName);
  check('wamid is the dedupe id', events[0]?.messageId === 'wamid.TEXT', events[0]?.messageId);

  const interactive = structuredClone(text);
  interactive.entry[0].changes[0].value.messages = [
    {
      from: '966500000000',
      id: 'wamid.BTN',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'book_now', title: 'Book now' } },
    },
  ];
  const tapped = whatsappAdapter.parse(interactive, ctx(null));
  check('interactive button reply parses', tapped.length === 1, tapped.length);
  check('the button id (not the title) becomes the text', tapped[0]?.text === 'book_now', tapped[0]?.text);

  const referral = structuredClone(text);
  referral.entry[0].changes[0].value.messages = [
    {
      from: '966500000000',
      id: 'wamid.REF',
      type: 'text',
      text: { body: 'I saw your ad' },
      referral: { source_id: 'ad-9911', source_url: 'https://fb.me/x', ctwa_clid: 'clid-1' },
    },
  ];
  const fromAd = whatsappAdapter.parse(referral, ctx(null));
  check('click-to-WhatsApp ad id is captured', fromAd[0]?.referral === 'ad-9911', fromAd[0]?.referral);

  const statusOnly = structuredClone(text);
  delete statusOnly.entry[0].changes[0].value.messages;
  statusOnly.entry[0].changes[0].value.statuses = [{ id: 'wamid.TEXT', status: 'delivered' }];
  check('delivery statuses produce no events', whatsappAdapter.parse(statusOnly, ctx(null)).length === 0);
}

// ------------------------------------------------------ Signature checking --
section('Signature verification');
{
  const raw = JSON.stringify({ event: 'message', sender: { id: 'u1' }, message: { type: 'text', text: 'hi' } });

  // Viber: hex HMAC-SHA256 of the raw body, keyed by the bot auth token.
  const viberToken = 'viber-auth-token-abc';
  const viberSig = crypto.createHmac('sha256', viberToken).update(raw).digest('hex');
  check(
    'viber accepts a correct signature',
    viberAdapter.verifySignature(raw, new Headers({ 'x-viber-content-signature': viberSig }), viberToken),
  );
  check(
    'viber rejects a tampered body',
    !viberAdapter.verifySignature(`${raw} `, new Headers({ 'x-viber-content-signature': viberSig }), viberToken),
  );
  check(
    'viber rejects the wrong key',
    !viberAdapter.verifySignature(raw, new Headers({ 'x-viber-content-signature': viberSig }), 'other-token'),
  );
  check('viber rejects a missing signature header', !viberAdapter.verifySignature(raw, new Headers(), viberToken));
  check('viber skips verification when no secret is stored', viberAdapter.verifySignature(raw, new Headers(), null));

  // LINE: base64 HMAC-SHA256 of the raw body, keyed by the channel secret.
  const lineSecret = 'line-channel-secret-xyz';
  const lineSig = crypto.createHmac('sha256', lineSecret).update(raw).digest('base64');
  check(
    'line accepts a correct signature',
    lineAdapter.verifySignature(raw, new Headers({ 'x-line-signature': lineSig }), lineSecret),
  );
  check(
    'line rejects a hex-encoded signature (wrong encoding)',
    !lineAdapter.verifySignature(
      raw,
      new Headers({ 'x-line-signature': crypto.createHmac('sha256', lineSecret).update(raw).digest('hex') }),
      lineSecret,
    ),
  );
  check(
    'line rejects a body that changed after signing',
    !lineAdapter.verifySignature(`${raw}x`, new Headers({ 'x-line-signature': lineSig }), lineSecret),
  );
  check('line rejects a missing signature header', !lineAdapter.verifySignature(raw, new Headers(), lineSecret));

  // Meta: "sha256=" + hex HMAC of the raw body, keyed by the APP secret (env).
  const appSecret = 'meta-app-secret-123';
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = appSecret;
  const metaSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
  check(
    'meta accepts a correct signature',
    facebookAdapter.verifySignature(raw, new Headers({ 'x-hub-signature-256': metaSig }), null),
  );
  check(
    'meta rejects a signature from another app secret',
    !facebookAdapter.verifySignature(
      raw,
      new Headers({ 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'nope').update(raw).digest('hex') }),
      null,
    ),
  );
  check(
    'meta rejects an unsigned delivery once a secret is configured',
    !facebookAdapter.verifySignature(raw, new Headers(), null),
  );
  check(
    'instagram shares the same app-secret check',
    instagramAdapter.verifySignature(raw, new Headers({ 'x-hub-signature-256': metaSig }), null),
  );
  delete process.env.META_APP_SECRET;
  delete process.env.WHATSAPP_APP_SECRET;
  check(
    'meta skips verification when no app secret is configured (dev)',
    facebookAdapter.verifySignature(raw, new Headers(), null),
  );
  if (previous === undefined) delete process.env.META_APP_SECRET;
  else process.env.META_APP_SECRET = previous;
}

// ------------------------------------------------------- Outbound mapping --
section('Outbound mapping — WhatsApp buttons');
{
  const three = whatsappMessages({
    type: 'buttons',
    text: 'Which would you like?',
    buttons: [
      { label: 'Book a table', value: 'book' },
      { label: 'See the menu', value: 'menu' },
      { label: 'Opening hours', value: 'hours' },
    ],
  });
  check('3 options stay a reply-button message', three[0]?.interactive?.type === 'button', three[0]?.interactive?.type);
  check('all three buttons are sent', three[0]?.interactive?.action?.buttons?.length === 3);

  const five = whatsappMessages({
    type: 'buttons',
    text: 'Pick a service',
    buttons: [
      { label: 'Haircut', value: 'cut' },
      { label: 'Colour', value: 'colour' },
      { label: 'Beard trim', value: 'beard' },
      { label: 'Shave', value: 'shave' },
      { label: 'Kids cut', value: 'kids' },
    ],
  });
  // WhatsApp caps reply buttons at 3, so a wider set has to become a list.
  check('more than 3 options become a list message', five[0]?.interactive?.type === 'list', five[0]?.interactive?.type);
  check('the list carries one section', five[0]?.interactive?.action?.sections?.length === 1);
  check('every option becomes a row', five[0]?.interactive?.action?.sections?.[0]?.rows?.length === 5);
  check('rows keep the payload as the row id', five[0]?.interactive?.action?.sections?.[0]?.rows?.[0]?.id === 'cut');
  check('the list has a button label', Boolean(five[0]?.interactive?.action?.button));
  check('body text is preserved', five[0]?.interactive?.body?.text === 'Pick a service');

  const eleven = whatsappMessages({
    type: 'quick_replies',
    text: 'Choose a branch',
    options: Array.from({ length: 11 }, (_, i) => ({ label: `Branch ${i + 1}`, value: `b${i + 1}` })),
  });
  // A list section holds 10 rows; anything past that must be truncated, not sent.
  check('a list never exceeds 10 rows', eleven[0]?.interactive?.action?.sections?.[0]?.rows?.length === 10);

  const withUrl = whatsappMessages({
    type: 'buttons',
    text: 'Anything else?',
    buttons: [
      { label: 'Talk to a human', value: 'agent' },
      { label: 'Visit our site', url: 'https://example.com' },
    ],
  });
  check('tap buttons and URL buttons are split into two messages', withUrl.length === 2, withUrl.length);
  check('the URL is delivered as text', String(withUrl[1]?.text?.body ?? '').includes('https://example.com'));
}

section('Outbound mapping — Telegram gallery');
{
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  let delivered;
  try {
    delivered = await telegramAdapter.send(
      { companyId: 'c1', channel: 'telegram', externalId: '7788990', secret: '7788990:TESTTOKEN', settings: {} },
      '500100',
      [
        {
          type: 'gallery',
          items: [
            {
              title: 'Deluxe room',
              subtitle: 'Sea view, breakfast included',
              imageUrl: 'https://cdn.example.com/deluxe.jpg',
              buttons: [
                { label: 'Book', value: 'book:deluxe' },
                { label: 'Details', url: 'https://example.com/deluxe' },
              ],
            },
            { title: 'Standard room', subtitle: 'City view' },
          ],
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  check('the gallery is delivered', delivered === true, delivered);
  // Telegram has no carousel, so each card is its own message.
  check('one Telegram call per card', calls.length === 2, calls.length);
  check('a card with an image uses sendPhoto', calls[0]?.url.endsWith('/sendPhoto'), calls[0]?.url);
  check('the bot token is in the path, never the body', calls[0]?.url.includes('/bot7788990:TESTTOKEN/'));
  check('the photo is the card image', calls[0]?.body?.photo === 'https://cdn.example.com/deluxe.jpg');
  check(
    'title and subtitle become the caption',
    calls[0]?.body?.caption === 'Deluxe room\nSea view, breakfast included',
    calls[0]?.body?.caption,
  );
  check('card buttons become an inline keyboard', calls[0]?.body?.reply_markup?.inline_keyboard?.length === 2);
  check(
    'a value button becomes callback_data',
    calls[0]?.body?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === 'book:deluxe',
  );
  check(
    'a url button becomes a url button',
    calls[0]?.body?.reply_markup?.inline_keyboard?.[1]?.[0]?.url === 'https://example.com/deluxe',
  );
  check('an image-less card falls back to sendMessage', calls[1]?.url.endsWith('/sendMessage'), calls[1]?.url);
  check('the fallback card keeps its text', calls[1]?.body?.text === 'Standard room\nCity view', calls[1]?.body?.text);
  check('an image-less card with no buttons sends no keyboard', calls[1]?.body?.reply_markup === undefined);
}

console.log(
  failures === 0
    ? '\n🎉 All channel adapter checks passed.'
    : `\n❌ ${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
