# Exercice Web Push

Application Node.js minimale pour tester Web Push avec VAPID, un service worker et la librairie `web-push`.

## Routes

- `GET /subscription` : page utilisateur qui demande l'autorisation de notification, enregistre le service worker et envoie la subscription au serveur.
- `POST /subscription` : recoit et stocke la subscription du navigateur.
- `GET /send-notification` : page admin avec une zone de texte et un bouton d'envoi.
- `POST /send-notification` : envoie le message a tous les navigateurs inscrits.

## Generer les cles VAPID avec Docker

```bash
docker build -f Dockerfile.vapid -t vapid-generator .
docker run --rm vapid-generator
```

Copier ensuite :

- `Public Key` dans `PUBLIC_VAPID_KEY`
- `Private Key` dans `PRIVATE_VAPID_KEY`

La cle privee doit rester cote serveur.

## Lancer en local

Installer les dependances :

```bash
npm install
```

Configurer les variables d'environnement :

```bash
set PUBLIC_VAPID_KEY=VOTRE_CLE_PUBLIQUE
set PRIVATE_VAPID_KEY=VOTRE_CLE_PRIVEE
set VAPID_SUBJECT=mailto:votre.email@example.com
npm start
```

Puis ouvrir :

- `http://localhost:8080/subscription`
- `http://localhost:8080/send-notification`

`localhost` est accepte par Chrome pour les service workers et les notifications, meme sans HTTPS.

## Deployer sur Google App Engine

Copier `app.example.yaml` vers `app.yaml`, remplacer les valeurs par vos cles VAPID (ce fichier est volontairement ignore par Git), puis :

```bash
gcloud app deploy
```

L'URL a envoyer pour l'inscription est :

```text
https://VOTRE_PROJET.appspot.com/subscription
```

La page admin est :

```text
https://VOTRE_PROJET.appspot.com/send-notification
```

## Deployer sur Cloud Run

Construire et deployer l'image en configurant les variables d'environnement `PUBLIC_VAPID_KEY`, `PRIVATE_VAPID_KEY` et `VAPID_SUBJECT`.

Le stockage actuel est en memoire : il suffit pour l'exercice et la demonstration, mais les subscriptions sont perdues si l'instance redemarre. Pour une application reelle, il faudrait une base de donnees.
