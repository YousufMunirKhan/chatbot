# Mobile Embed Kit

Put the customer chat inside **your own** Android or iOS app.

There is no native SDK to add, no library to keep up to date, and nothing to
ship through the app stores when the assistant changes. You load one URL in a
WebView; a small JavaScript bridge tells your app what is happening inside it.

- **Chat address**: `https://<your app domain>/embed/<publicBotId>`
- **Bridge**: `/sdk/mobile/embed-bridge.js`, loaded by that page automatically
- **Where to get your `publicBotId` and signing secret**: dashboard →
  **Website chat** → *Inside your own mobile app*

An engineer who has built a WebView screen before should have this working in an
afternoon.

---

## 1. What the page gives you

- Full-screen chat, mobile-first, aware of the notch and the home indicator.
- The same `/api/chat` streaming contract the website widget uses, so a
  conversation started in your app is the same conversation your agents see in
  the inbox, on the same assistant, with the same knowledge and tools.
- Live agent replies over SSE — when a human takes over, their messages arrive
  without polling.
- Right-to-left layout when the customer's locale is Arabic.

Query parameters:

| Parameter   | Required | Meaning |
| ----------- | -------- | ------- |
| `user_id`   | no | Your id for this customer. Must be signed to be believed. |
| `name`      | no | Display name. Ignored unless `user_id` verifies. |
| `email`     | no | Ignored unless `user_id` verifies. |
| `phone`     | no | Ignored unless `user_id` verifies. |
| `locale`    | no | `en`, `ar`, … Sets the reading direction. |
| `signature` | no | `HMAC-SHA256(signing secret, user_id)`, hex. |
| `close`     | no | `close=0` hides the in-chat close button when your app has its own nav bar. |

---

## 2. Identity: sign it, or stay anonymous

Your app can *claim* anything. A URL is visible to anyone with the device, a
proxy, or a decompiler, so an unsigned `user_id=123` would let anyone read and
write another customer's conversation by editing one character.

So the claim is signed:

```
signature = HMAC_SHA256(key = <bot signing secret>, message = <user_id>)   # hex
```

We recompute it server-side and compare in constant time before the page
renders. **Compute the signature on your server**, never in the app: the secret
must not be in the binary, in an environment file bundled with the app, or in
anything the customer's device can read.

What happens in each case:

| Situation | Result |
| --------- | ------ |
| No `user_id` at all | Anonymous visitor. Chat works normally. |
| `user_id` with no `signature` | **Anonymous.** The claim is ignored. |
| `signature` does not match | **Anonymous.** The claim is ignored. |
| No signing secret created yet | **Anonymous.** Create one in the dashboard. |
| Signature verifies | Identified. Conversations thread together across sessions and devices, and the agent sees the name and email you passed. |

Anonymous is never an error state and never blocks the chat. It just means the
agent sees "Visitor" instead of "Sam Okafor", and a new device starts a fresh
thread.

Example (Node, on your server):

```js
import { createHmac } from 'node:crypto';

export function chatSignature(customerId) {
  return createHmac('sha256', process.env.CHAT_SIGNING_SECRET)
    .update(customerId, 'utf8')
    .digest('hex');
}
```

Kotlin, on your server:

```kotlin
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

fun chatSignature(customerId: String, secret: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
    return mac.doFinal(customerId.toByteArray()).joinToString("") { "%02x".format(it) }
}
```

Rotating the secret (the **Regenerate** button) invalidates every signature made
with the old one immediately. Customers running an old app build keep chatting —
they simply drop back to anonymous until your server is updated.

---

## 3. The bridge: what your app hears

`window.ChatBridge` posts JSON strings to your app. Every message has the same
envelope:

```json
{
  "source": "chat-bridge",
  "version": 1,
  "type": "conversation_started",
  "ts": 1717070000000,
  "payload": { "conversationId": "…", "botId": "…" }
}
```

Ignore anything whose `source` is not `chat-bridge`, and anything whose
`version` you do not recognise.

| `type` | `payload` | When |
| ------ | --------- | ---- |
| `ready` | `{ botId, identity }` | Once, when the chat is interactive. `identity` is `verified`, `anonymous`, `unsigned`, `invalid`, or `unconfigured` — log it during integration, it tells you immediately whether your signature is right. |
| `conversation_started` | `{ conversationId, botId }` | Once per conversation, after the customer's first message. Store it if you want to deep-link back. |
| `unread_count_changed` | `{ count }` | A message arrived while the chat screen was not visible. Resets to `0` when it becomes visible. Drive your tab badge with this. |
| `human_requested` | `{ conversationId }` | The conversation was handed to a human agent. Good moment to make sure your push permission is granted. |
| `close_pressed` | `{}` | The customer tapped the close control. **The page does not close itself** — dismiss your view controller / `finish()` your Activity. |
| `error` | `{ code, message }` | Something the customer can see went wrong. |

And what your app can send **in**:

```js
// After your customer signs in, without reloading the screen yourself:
ChatBridge.setUser({
  userId: "cus_123",
  name: "Sam Okafor",
  email: "sam@example.com",
  locale: "en",
  signature: "<from your server>"
});

// Behave as though the close control was tapped:
ChatBridge.close();
```

`setUser` reloads the chat with the new identity, because verification happens
server-side. Call it with no `userId` to sign the customer back out.

---

## 4. Android (Kotlin)

Register the JavaScript interface under exactly the name **`AndroidChatBridge`**.

```kotlin
package com.example.app.chat

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebResourceRequest
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class ChatActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    // Camera + gallery picker. Without this, "attach a photo" silently does
    // nothing in a WebView — the file input has no default handler.
    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            filePathCallback?.onReceiveValue(uris)
            filePathCallback = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true          // the chat is a web app
            domStorageEnabled = true          // it keeps its visitor id in localStorage
            mediaPlaybackRequiresUserGesture = false
            // Leave file:// access off. The chat never needs it, and enabling it
            // widens the attack surface of every page the WebView ever loads.
        }

        webView.addJavascriptInterface(ChatBridge(), "AndroidChatBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                // Keep our own pages in the WebView; hand everything else — a
                // link in an answer, a tel:, a mailto: — to the system. A
                // WebView is a terrible browser and a worse mail client.
                if (url.host == CHAT_HOST) return false
                startActivity(Intent(Intent.ACTION_VIEW, url))
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                filePicker.launch(params.createIntent())
                return true
            }

            // Only needed if you enable camera capture in a future chat version.
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread { request.grant(request.resources) }
            }
        }

        webView.loadUrl(buildChatUrl())
    }

    private fun buildChatUrl(): String {
        val session = SessionStore.current()            // your own session
        val builder = Uri.parse(CHAT_URL).buildUpon()
        if (session != null) {
            builder.appendQueryParameter("user_id", session.customerId)
            builder.appendQueryParameter("name", session.name)
            builder.appendQueryParameter("email", session.email)
            // Fetched from YOUR backend; never computed on the device.
            builder.appendQueryParameter("signature", session.chatSignature)
        }
        return builder.build().toString()
    }

    // ---- the bridge ------------------------------------------------------
    inner class ChatBridge {
        @JavascriptInterface
        fun postMessage(raw: String) {
            val message = JSONObject(raw)
            if (message.optString("source") != "chat-bridge") return
            val payload = message.optJSONObject("payload") ?: JSONObject()

            // JavascriptInterface callbacks arrive on a background thread.
            runOnUiThread {
                when (message.optString("type")) {
                    "ready" ->
                        android.util.Log.d("Chat", "identity=${payload.optString("identity")}")
                    "conversation_started" ->
                        SessionStore.rememberConversation(payload.optString("conversationId"))
                    "unread_count_changed" ->
                        BadgeBus.publish(payload.optInt("count"))
                    "human_requested" ->
                        PushPermission.ensureGranted(this@ChatActivity)
                    "close_pressed" ->
                        finish()
                    "error" ->
                        android.util.Log.w("Chat", payload.optString("message"))
                }
            }
        }
    }

    // Call this after your customer signs in while the chat is already open.
    fun handOverIdentity(customerId: String, name: String, signature: String) {
        val json = JSONObject()
            .put("userId", customerId)
            .put("name", name)
            .put("signature", signature)
        webView.evaluateJavascript("window.ChatBridge.setUser($json)", null)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        const val CHAT_HOST = "app.example.com"
        const val CHAT_URL = "https://app.example.com/embed/YOUR_PUBLIC_BOT_ID"
    }
}
```

`AndroidManifest.xml` — the WebView needs the internet, and the file chooser
needs the camera permission only if you let customers take a photo directly:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

### Forwarding push notifications (FCM)

Web push does **not** reach a WebView. If you want the customer notified when an
agent replies while your app is closed, that notification must come through
*your* FCM setup, triggered by *your* backend. The chain:

1. Add a webhook endpoint in the dashboard (**Notifications → delivery
   settings**, or **Developers → webhooks**) pointing at your server.
2. Your server receives the event (`human_takeover`, an agent reply) and looks
   up the customer's FCM token by the `user_id` you signed.
3. Your server sends the FCM message, with the conversation id in the data
   payload.
4. Your `FirebaseMessagingService` opens `ChatActivity` with that conversation.

```kotlin
class ChatMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val conversationId = message.data["conversationId"] ?: return
        val intent = Intent(this, ChatActivity::class.java)
            .putExtra("conversationId", conversationId)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)

        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        NotificationManagerCompat.from(this).notify(
            conversationId.hashCode(),
            NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(message.notification?.title ?: "New reply")
                .setContentText(message.notification?.body ?: "")
                .setSmallIcon(R.drawable.ic_chat)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build()
        )
    }
}
```

---

## 5. iOS (Swift)

Register the script message handler under exactly the name **`chatBridge`**.

```swift
import UIKit
import WebKit

final class ChatViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {

    private var webView: WKWebView!
    private let chatHost = "app.example.com"
    private let chatURL = "https://app.example.com/embed/YOUR_PUBLIC_BOT_ID"

    override func viewDidLoad() {
        super.viewDidLoad()

        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "chatBridge")
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        // The chat page handles the notch itself via env(safe-area-inset-*),
        // so let it draw edge to edge rather than insetting the WebView.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(webView)

        webView.load(URLRequest(url: buildChatURL()))
    }

    private func buildChatURL() -> URL {
        var components = URLComponents(string: chatURL)!
        if let session = SessionStore.current {
            components.queryItems = [
                URLQueryItem(name: "user_id", value: session.customerId),
                URLQueryItem(name: "name", value: session.name),
                URLQueryItem(name: "email", value: session.email),
                // Fetched from YOUR backend; never computed on the device.
                URLQueryItem(name: "signature", value: session.chatSignature)
            ]
        }
        return components.url!
    }

    // MARK: - Bridge

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "chatBridge",
              let raw = message.body as? String,
              let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["source"] as? String == "chat-bridge" else { return }

        let payload = json["payload"] as? [String: Any] ?? [:]

        switch json["type"] as? String {
        case "ready":
            print("chat identity:", payload["identity"] as? String ?? "unknown")
        case "conversation_started":
            SessionStore.rememberConversation(payload["conversationId"] as? String)
        case "unread_count_changed":
            BadgeBus.publish(payload["count"] as? Int ?? 0)
        case "human_requested":
            UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        case "close_pressed":
            dismiss(animated: true)
        case "error":
            print("chat error:", payload["message"] as? String ?? "")
        default:
            break
        }
    }

    /// Call after your customer signs in while the chat is already open.
    func handOverIdentity(customerId: String, name: String, signature: String) {
        let user: [String: String] = ["userId": customerId, "name": name, "signature": signature]
        guard let data = try? JSONSerialization.data(withJSONObject: user),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.ChatBridge.setUser(\(json))")
    }

    // MARK: - External links

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        // Keep our own pages inside; open everything else in Safari.
        if url.host == chatHost {
            decisionHandler(.allow)
        } else {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    // Target="_blank" links have no frame to open into; route them out too.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { UIApplication.shared.open(url) }
        return nil
    }

    deinit {
        // Otherwise the content controller retains this view controller forever.
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "chatBridge")
    }
}
```

`Info.plist` — required only if you let customers attach a photo. iOS shows the
purpose string verbatim, and an app that requests the camera without one is
rejected:

```xml
<key>NSCameraUsageDescription</key>
<string>Take a photo to send to our support team.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Attach a photo from your library to your support conversation.</string>
<key>NSMicrophoneUsageDescription</key>
<string>Record a voice message for our support team.</string>
```

`WKWebView` handles `<input type="file">` itself — you do not need to write a
picker as you do on Android.

### Forwarding push notifications (APNs)

Same shape as Android: our web push goes to the *dashboard app your agents use*,
not to your customers' phones. Customer-facing notifications are yours to send.

1. Webhook from us → your server.
2. Your server maps the signed `user_id` to the device's APNs token.
3. Your server sends the APNs push with the conversation id in the payload.
4. `userNotificationCenter(_:didReceive:)` opens `ChatViewController`.

```swift
func userNotificationCenter(_ center: UNUserNotificationCenter,
                            didReceive response: UNNotificationResponse,
                            withCompletionHandler completionHandler: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    if let conversationId = info["conversationId"] as? String {
        AppRouter.openChat(conversationId: conversationId)
    }
    completionHandler()
}
```

---

## 6. What this gives you — and what it does not

**You get**

- The full assistant: knowledge, tools, orders, bookings, human handoff, live
  agent replies, CSAT — identical to the website chat, because it *is* the
  website chat's engine.
- Changes ship instantly. New assistant behaviour, new branding, new quick
  actions: no app release, no store review, no version fragmentation.
- One codebase for Android, iOS, and the web. One set of bugs.
- Verified customer identity, so conversations thread across devices and your
  agents see who they are talking to.
- File attachments through the platform's own picker (with the Android code
  above; free on iOS).

**You do not get**

- **Offline access.** The chat needs a connection. There is no local message
  store and no send queue; a message composed on the underground is lost.
- **Customer push notifications.** Web push does not reach a WebView. You must
  forward them through your own FCM/APNs setup, driven by a webhook to your
  server (section 4 and 5). This is the single biggest piece of work in the
  integration.
- **Native UI.** It is a web view. It is fast and it respects safe areas, but it
  will not use your app's own components, fonts, or transitions, and a
  determined designer will spot it.
- **Deep OS integration.** No share sheet, no Siri intents, no widgets, no
  App Clips, no background sync.
- **Native haptics or gestures.** Swipe-to-go-back works only if you wire the
  WebView's history to it (the Android snippet above does).
- **A dependency-free binary size win worth mentioning.** It is genuinely
  smaller than an SDK, but that is rarely why anyone chooses this.

If your product needs offline chat or fully native chrome, a WebView embed is
the wrong tool and you want a real native client. For everything else — support
chat inside an app that already has a network requirement — this is less code,
less release risk, and one place to fix a bug.

---

## 7. Checklist

- [ ] `publicBotId` copied from the dashboard.
- [ ] Signing secret created; stored on your **server**, not in the app.
- [ ] Your server exposes an endpoint returning the signature for the signed-in
      customer.
- [ ] WebView: JavaScript enabled, DOM storage enabled.
- [ ] Bridge registered as `AndroidChatBridge` / `chatBridge`.
- [ ] `close_pressed` dismisses your screen.
- [ ] External links open outside the WebView.
- [ ] File chooser wired (Android) and usage strings added (iOS).
- [ ] `ready` logs `identity=verified` in a build signed against your server.
- [ ] Webhook → FCM/APNs path built, if you want customers notified.
