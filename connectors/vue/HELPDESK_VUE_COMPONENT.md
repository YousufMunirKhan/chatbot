# Vue Help Desk Component Guide

Use this for Vue, Nuxt, or Laravel Inertia Vue admin dashboards.

This is the staff chat UI layer. Use `web/HelpdeskWebAppDetails.js` for the backend connector manifest, action handlers, and route IDs, then map those route IDs in this Vue component.

## Required Backend Setup

Create a connector in Switch&Save **Company -> Internal Help Desk -> Create connector** and store the `hdk_...` token on your backend as `HELPDESK_CONNECTOR_TOKEN`. This Vue component must call your backend proxy, not Switch&Save directly.

Add a staff-only **Help Desk** item in your admin navigation and render this component only for authenticated staff/admin roles.

## Basic Shape

```vue
<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  currentRoute: String,
  staffRole: String,
})

const router = useRouter()
const open = ref(false)
const messages = ref([])

async function ask(text) {
  const res = await fetch('/admin/helpdesk/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      currentRoute: props.currentRoute,
      staffRole: props.staffRole,
    }),
  })
  const data = await res.json()
  messages.value.push({ role: 'assistant', text: data.answer })
}

function openRoute(routeId) {
  const routes = {
    'purchase_orders.create': '/purchase/orders/new',
  }
  if (routes[routeId]) router.push(routes[routeId])
}
</script>
```

Use your backend as a proxy so the connector token is not exposed.
