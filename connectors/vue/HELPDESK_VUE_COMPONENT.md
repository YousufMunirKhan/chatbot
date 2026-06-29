# Vue Help Desk Component Guide

Use this for Vue, Nuxt, or Laravel Inertia Vue admin dashboards.

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
