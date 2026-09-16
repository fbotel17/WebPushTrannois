const statusElement = document.querySelector("#status");
const subscribeButton = document.querySelector("#subscribeButton");

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", isError);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function getPublicVapidKey() {
  const response = await fetch("/vapid-public-key");

  if (!response.ok) {
    throw new Error("Impossible de recuperer la cle VAPID publique.");
  }

  const data = await response.json();

  if (!data.publicKey) {
    throw new Error("La cle VAPID publique n'est pas configuree.");
  }

  return data.publicKey;
}

async function subscribeToPush() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker non supporte par ce navigateur.");
  }

  if (!("PushManager" in window)) {
    throw new Error("PushManager non supporte par ce navigateur.");
  }

  if (!("Notification" in window)) {
    throw new Error("Notification non supporte par ce navigateur.");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Permission refusee pour les notifications.");
  }

  setStatus("Installation du service worker...");

  const registration = await navigator.serviceWorker.register("/service-worker.js");
  await navigator.serviceWorker.ready;

  setStatus("Creation de la subscription...");

  const publicKey = await getPublicVapidKey();
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    }));

  const response = await fetch("/subscription", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(subscription)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const result = await response.json();
  setStatus(`Navigateur inscrit. Total connu par ce serveur: ${result.count}.`);
}

if (subscribeButton) {
  subscribeButton.addEventListener("click", async () => {
    subscribeButton.disabled = true;

    try {
      await subscribeToPush();
    } catch (error) {
      setStatus(error.message, true);
      subscribeButton.disabled = false;
    }
  });
}
