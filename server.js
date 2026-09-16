const http = require("http");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const PORT = process.env.PORT || 8080;
const PUBLIC_VAPID_KEY = process.env.PUBLIC_VAPID_KEY || "";
const PRIVATE_VAPID_KEY = process.env.PRIVATE_VAPID_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
const hasRealVapidKeys = Boolean(
  PUBLIC_VAPID_KEY &&
    PRIVATE_VAPID_KEY &&
    !PUBLIC_VAPID_KEY.includes("A_REMPLACER") &&
    !PRIVATE_VAPID_KEY.includes("A_REMPLACER")
);

const publicDir = path.join(__dirname, "public");
const subscriptions = new Map();

if (hasRealVapidKeys) {
  webpush.setVapidDetails(VAPID_SUBJECT, PUBLIC_VAPID_KEY, PRIVATE_VAPID_KEY);
}

function send(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendJson(res, statusCode, data) {
  send(res, statusCode, JSON.stringify(data), "application/json; charset=utf-8");
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 1_000_000) {
        reject(new Error("Payload trop volumineux."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Fichier introuvable.");
      return;
    }

    send(res, 200, data, contentType);
  });
}

function isValidSubscription(subscription) {
  return Boolean(
    subscription &&
      typeof subscription.endpoint === "string" &&
      subscription.keys &&
      typeof subscription.keys.p256dh === "string" &&
      typeof subscription.keys.auth === "string"
  );
}

function saveSubscription(subscription) {
  subscriptions.set(subscription.endpoint, subscription);
}

async function handleSubscriptionPost(req, res) {
  const body = await readRequestBody(req);
  const subscription = JSON.parse(body || "{}");

  if (!isValidSubscription(subscription)) {
    sendJson(res, 400, { error: "Subscription invalide." });
    return;
  }

  saveSubscription(subscription);
  sendJson(res, 201, {
    message: "Subscription enregistree.",
    count: subscriptions.size
  });
}

async function sendNotificationToAll(message) {
  if (!hasRealVapidKeys) {
    throw new Error("Les cles VAPID ne sont pas configurees sur le serveur.");
  }

  const payload = JSON.stringify({
    title: "Notification Web Push",
    body: message || "Message de test",
    url: "/subscription"
  });

  const results = await Promise.allSettled(
    Array.from(subscriptions.values()).map((subscription) =>
      webpush.sendNotification(subscription, payload)
    )
  );

  let sent = 0;
  let removed = 0;
  const failed = [];
  const endpoints = Array.from(subscriptions.keys());

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }

    const endpoint = endpoints[index];
    const statusCode = result.reason && result.reason.statusCode;

    if (statusCode === 404 || statusCode === 410) {
      subscriptions.delete(endpoint);
      removed += 1;
      return;
    }

    failed.push({
      endpoint,
      statusCode: statusCode || null,
      message: result.reason && result.reason.message
    });
  });

  return {
    sent,
    failed: failed.length,
    removed,
    total: subscriptions.size,
    errors: failed
  };
}

async function handleSendNotificationPost(req, res) {
  const body = await readRequestBody(req);
  const params = new URLSearchParams(body);
  const message = params.get("message") || "";

  const result = await sendNotificationToAll(message.trim());

  send(
    res,
    200,
    renderAdminPage({
      status: `Message envoye a ${result.sent} navigateur(s). Echecs: ${result.failed}. Supprimes: ${result.removed}.`
    }),
    "text/html; charset=utf-8"
  );
}

function renderPage(title, body) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  ${body}
</body>
</html>`;
}

function renderSubscriptionPage() {
  const configured = hasRealVapidKeys;

  return renderPage(
    "Inscription Web Push",
    `<main class="shell">
      <section class="panel">
        <p class="kicker">Web Push</p>
        <h1>Inscription aux notifications</h1>
        <p>Cette page enregistre le navigateur avec un service worker, demande l'autorisation d'afficher des notifications, puis envoie la subscription au serveur.</p>

        <div class="actions">
          <button id="subscribeButton" type="button"${configured ? "" : " disabled"}>Accepter les notifications</button>
          <a class="link-button" href="/send-notification">Page admin</a>
        </div>

        <p id="status" class="${configured ? "status" : "status error"}">
          ${configured ? "Pret a enregistrer ce navigateur." : "Cle publique VAPID absente. Configure PUBLIC_VAPID_KEY cote serveur."}
        </p>
      </section>
    </main>
    <script src="/app.js"></script>`
  );
}

function renderAdminPage({ status = "" } = {}) {
  return renderPage(
    "Envoi Web Push",
    `<main class="shell">
      <section class="panel">
        <p class="kicker">Administration</p>
        <h1>Envoyer une notification</h1>
        <p>Le message sera envoye a tous les navigateurs inscrits actuellement connus par ce serveur.</p>

        <form method="post" action="/send-notification">
          <label for="message">Message</label>
          <textarea id="message" name="message" rows="5" required placeholder="Votre message..."></textarea>
          <button type="submit">Envoyer</button>
        </form>

        <p class="status">${subscriptions.size} navigateur(s) inscrit(s).</p>
        ${status ? `<p class="status">${status}</p>` : ""}
        <a class="plain-link" href="/subscription">Retour a l'inscription</a>
      </section>
    </main>`
  );
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      redirect(res, "/subscription");
      return;
    }

    if (req.method === "GET" && url.pathname === "/subscription") {
      send(res, 200, renderSubscriptionPage(), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "POST" && url.pathname === "/subscription") {
      await handleSubscriptionPost(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/send-notification") {
      send(res, 200, renderAdminPage(), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "POST" && url.pathname === "/send-notification") {
      await handleSendNotificationPost(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/vapid-public-key") {
      sendJson(res, 200, { publicKey: hasRealVapidKeys ? PUBLIC_VAPID_KEY : "" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/service-worker.js") {
      serveFile(res, path.join(publicDir, "service-worker.js"), "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      serveFile(res, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/style.css") {
      serveFile(res, path.join(publicDir, "style.css"), "text/css; charset=utf-8");
      return;
    }

    send(res, 404, "Page introuvable.");
  } catch (error) {
    send(res, 500, error.message || "Erreur serveur.");
  }
}

http.createServer(router).listen(PORT, () => {
  console.log(`Serveur Web Push demarre sur http://localhost:${PORT}`);
});
