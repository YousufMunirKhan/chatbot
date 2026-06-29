# React Help Desk Component Guide

Use this for React, Next.js admin dashboards, or Inertia React apps.

## Basic Shape

```tsx
function HelpdeskChat({ currentRoute, staffRole }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);

  async function ask(text: string) {
    const res = await fetch('/admin/helpdesk/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, currentRoute, staffRole }),
    });
    const data = await res.json();
    setMessages((m) => [...m, { role: 'assistant', text: data.answer }]);
  }

  return open ? <ChatPanel ask={ask} /> : <button onClick={() => setOpen(true)}>Help</button>;
}
```

Use your backend as a proxy so the connector token is not exposed.

## Navigation

When response includes:

```json
{ "routeId": "purchase_orders.create" }
```

map it locally:

```tsx
const routes = {
  'purchase_orders.create': '/purchase/orders/new',
};

router.push(routes[routeId]);
```
