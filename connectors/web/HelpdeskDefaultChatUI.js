import { defaultHelpdeskChatSettings, shouldShowHelpdeskChat } from './HelpdeskEmbeddedChat.js';

const defaultQuickQuestions = [
  'How do I add product?',
  'Check stock',
  'Update product price',
  'Create purchase order',
  'Daily sales report',
];

const defaultCategories = ['For You', 'Products', 'Reports', 'Stock', 'Customers'];

export function mountHelpdeskDefaultChat({
  root,
  client,
  settings = defaultHelpdeskChatSettings,
  currentRoute = 'dashboard',
  staffRole = 'staff',
  staffName = 'Aamir',
  quickQuestions = defaultQuickQuestions,
  categories = defaultCategories,
  routeIds = [],
  onOpenRoute,
} = {}) {
  if (!root) throw new Error('root is required');
  if (!client) throw new Error('client is required');

  const visible = shouldShowHelpdeskChat(settings, { route: currentRoute, role: staffRole });
  if (!visible) {
    root.innerHTML = '';
    return { visible: false };
  }

  injectHelpdeskDefaultStyles();

  root.innerHTML = `
    <section class="ss-helpdesk-card" data-view="chat">
      <header class="ss-helpdesk-topbar">
        <div class="ss-helpdesk-tabs" role="tablist" aria-label="Help Desk views">
          <button class="ss-helpdesk-tab is-active" type="button" data-helpdesk-view="chat">Chat</button>
          <button class="ss-helpdesk-tab" type="button" data-helpdesk-view="history">History</button>
        </div>
        <div class="ss-helpdesk-actions">
          <button class="ss-helpdesk-icon" type="button" data-helpdesk-view="settings" aria-label="Open setup">*</button>
          <button class="ss-helpdesk-icon" type="button" data-helpdesk-collapse aria-label="Collapse">></button>
        </div>
      </header>

      <main class="ss-helpdesk-body" data-helpdesk-panel="chat">
        <div class="ss-helpdesk-hero">
          <div class="ss-helpdesk-bot">bot</div>
          <h2>Hello ${escapeHtml(staffName)}</h2>
          <p>How can the assistant help you today?</p>
        </div>

        <div class="ss-helpdesk-quick-list">
          ${quickQuestions.map((question) => `<button type="button" data-question="${escapeAttr(question)}">* ${escapeHtml(question)}</button>`).join('')}
        </div>

        <div class="ss-helpdesk-chips">
          ${categories.map((category, index) => `<button type="button" class="${index === 0 ? 'is-active' : ''}">${escapeHtml(category)}</button>`).join('')}
        </div>

        <form class="ss-helpdesk-compose" data-helpdesk-compose>
          <textarea placeholder="Ask the assistant anything..." aria-label="Ask the assistant anything"></textarea>
          <div class="ss-helpdesk-compose-actions">
            <button class="ss-helpdesk-mic" type="button" aria-label="Voice input">mic</button>
            <button class="ss-helpdesk-send" type="submit" aria-label="Send">-></button>
          </div>
        </form>

        <div class="ss-helpdesk-response" data-helpdesk-response hidden></div>
      </main>

      <main class="ss-helpdesk-body" data-helpdesk-panel="history" hidden>
        <div class="ss-helpdesk-empty">
          <h3>History</h3>
          <p>Recent Help Desk questions will appear here when you store them in your app.</p>
        </div>
      </main>

      <main class="ss-helpdesk-body" data-helpdesk-panel="settings" hidden>
        <div class="ss-helpdesk-settings-head">
          <h3>Connector settings</h3>
          <p>Add routes in your app details file, then test them here before sync.</p>
        </div>

        <label class="ss-helpdesk-field">
          <span>Current route</span>
          <input value="${escapeAttr(currentRoute)}" data-current-route />
        </label>

        <label class="ss-helpdesk-field">
          <span>Route ID to verify</span>
          <input placeholder="inventory.products" list="ss-helpdesk-route-list" data-route-id />
          <datalist id="ss-helpdesk-route-list">
            ${routeIds.map((routeId) => `<option value="${escapeAttr(routeId)}"></option>`).join('')}
          </datalist>
        </label>

        <button class="ss-helpdesk-primary" type="button" data-test-route>Test route</button>
        <div class="ss-helpdesk-response" data-route-result hidden></div>

        <div class="ss-helpdesk-checklist">
          <strong>Before Sync</strong>
          <span>1. Add routeId in HelpdeskWebAppDetails.js.</span>
          <span>2. Map it to router.push(...), redirect, or admin URL.</span>
          <span>3. Test route here.</span>
          <span>4. Run Preview, Audit, then Sync.</span>
        </div>
      </main>
    </section>
  `;

  const card = root.querySelector('.ss-helpdesk-card');
  const textarea = root.querySelector('textarea');
  const response = root.querySelector('[data-helpdesk-response]');
  const routeResult = root.querySelector('[data-route-result]');

  root.querySelectorAll('[data-helpdesk-view]').forEach((button) => {
    button.addEventListener('click', () => showPanel(root, button.dataset.helpdeskView));
  });

  root.querySelectorAll('[data-question]').forEach((button) => {
    button.addEventListener('click', () => {
      textarea.value = button.dataset.question || '';
      textarea.focus();
    });
  });

  root.querySelector('[data-helpdesk-compose]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    response.hidden = false;
    response.textContent = 'Asking assistant...';
    try {
      const data = await client.ask(text);
      response.textContent = data.answer || data.message || JSON.stringify(data, null, 2);
    } catch (error) {
      response.textContent = `Ask failed: ${error.message}`;
    }
  });

  root.querySelector('[data-test-route]').addEventListener('click', async () => {
    const input = root.querySelector('[data-route-id]');
    const routeId = input.value.trim();
    routeResult.hidden = false;
    if (!routeId) {
      routeResult.textContent = 'Enter a routeId such as inventory.products.';
      return;
    }
    const opened = await Promise.resolve(
      onOpenRoute ? onOpenRoute(routeId) : client.openNavigationTarget(routeId),
    );
    routeResult.textContent = opened
      ? `Route verified: ${routeId}`
      : `Route not wired: add ${routeId} in HelpdeskWebAppDetails.js and map it to your router.`;
  });

  root.querySelector('[data-helpdesk-collapse]').addEventListener('click', () => {
    card.classList.toggle('is-collapsed');
  });

  return { visible: true, showPanel: (name) => showPanel(root, name) };
}

function showPanel(root, name) {
  root.querySelectorAll('[data-helpdesk-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.helpdeskPanel !== name;
  });
  root.querySelectorAll('[data-helpdesk-view]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.helpdeskView === name);
  });
}

function injectHelpdeskDefaultStyles() {
  if (document.getElementById('ss-helpdesk-default-styles')) return;
  const style = document.createElement('style');
  style.id = 'ss-helpdesk-default-styles';
  style.textContent = `
    .ss-helpdesk-card{width:min(568px,100%);border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#0f172a;font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 18px 50px rgba(15,23,42,.08);overflow:hidden}
    .ss-helpdesk-topbar{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eef2f7;padding:16px 20px}
    .ss-helpdesk-tabs{display:flex;gap:4px;padding:4px;border-radius:999px;background:#f1f5f9}
    .ss-helpdesk-tab,.ss-helpdesk-icon,.ss-helpdesk-quick-list button,.ss-helpdesk-chips button{border:0;background:transparent;color:#475569;cursor:pointer;font:inherit}
    .ss-helpdesk-tab{border-radius:999px;padding:9px 18px;font-weight:700}
    .ss-helpdesk-tab.is-active{background:#fff;color:#0f172a;box-shadow:0 1px 4px rgba(15,23,42,.08)}
    .ss-helpdesk-actions{display:flex;align-items:center;gap:10px}
    .ss-helpdesk-icon{width:34px;height:34px;border-radius:999px;color:#633ef3;font-weight:800;font-size:18px}
    .ss-helpdesk-body{padding:38px 20px 28px}
    .ss-helpdesk-hero{text-align:center;margin-bottom:18px}
    .ss-helpdesk-bot{display:grid;place-items:center;width:56px;height:56px;margin:0 auto 18px;border-radius:16px;background:#633ef3;color:#fff;font-weight:800}
    .ss-helpdesk-hero h2{margin:0 0 6px;font-size:24px;line-height:1.2}
    .ss-helpdesk-hero p{margin:0;color:#475569;font-size:16px}
    .ss-helpdesk-quick-list{display:grid;margin:8px 0 12px}
    .ss-helpdesk-quick-list button{text-align:left;padding:14px 8px;border-bottom:1px solid #f1f5f9;color:#25324a;font-size:15px}
    .ss-helpdesk-quick-list button:hover{color:#633ef3}
    .ss-helpdesk-chips{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 18px}
    .ss-helpdesk-chips button{border:1px solid #e2e8f0;border-radius:999px;padding:8px 14px;background:#fff}
    .ss-helpdesk-chips .is-active{border-color:#8b5cf6;color:#633ef3;font-weight:700}
    .ss-helpdesk-compose{min-height:126px;border:2px solid #172033;border-radius:28px;padding:18px;display:flex;flex-direction:column;gap:18px}
    .ss-helpdesk-compose textarea{min-height:58px;border:0;resize:vertical;outline:0;color:#172033;font:inherit;font-size:15px}
    .ss-helpdesk-compose textarea::placeholder{color:#94a3b8}
    .ss-helpdesk-compose-actions{display:flex;align-items:center;justify-content:space-between}
    .ss-helpdesk-mic,.ss-helpdesk-send,.ss-helpdesk-primary{border:0;cursor:pointer;font:inherit}
    .ss-helpdesk-mic{width:38px;height:38px;border-radius:999px;background:#fff;border:1px solid #e2e8f0;color:#64748b}
    .ss-helpdesk-send{width:44px;height:44px;border-radius:999px;background:#633ef3;color:#fff;font-weight:800}
    .ss-helpdesk-response{margin-top:16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:12px;color:#334155;white-space:pre-wrap}
    .ss-helpdesk-empty,.ss-helpdesk-settings-head{text-align:left}
    .ss-helpdesk-empty h3,.ss-helpdesk-settings-head h3{margin:0 0 6px;font-size:18px}
    .ss-helpdesk-empty p,.ss-helpdesk-settings-head p{margin:0 0 18px;color:#64748b}
    .ss-helpdesk-field{display:grid;gap:6px;margin:14px 0;color:#334155;font-weight:700}
    .ss-helpdesk-field input{border:1px solid #cbd5e1;border-radius:8px;padding:12px;font:inherit;color:#0f172a}
    .ss-helpdesk-primary{border-radius:999px;background:#633ef3;color:#fff;padding:11px 18px;font-weight:800}
    .ss-helpdesk-checklist{display:grid;gap:7px;margin-top:18px;border:1px solid #e2e8f0;border-radius:8px;padding:14px;color:#475569}
    .ss-helpdesk-checklist strong{color:#0f172a}
    .ss-helpdesk-card.is-collapsed .ss-helpdesk-body{display:none}
    @media(max-width:520px){.ss-helpdesk-card{border-radius:0}.ss-helpdesk-body{padding:28px 16px}.ss-helpdesk-topbar{padding:14px 16px}.ss-helpdesk-chips{overflow:auto;flex-wrap:nowrap}.ss-helpdesk-compose{border-radius:22px}}
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
