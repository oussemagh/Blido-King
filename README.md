# Blido King : déploiement

Le jeu est une page unique (`index.html`). Pour le **multijoueur en ligne** (salles avec code), un petit
serveur WebSocket (`server.js`) relaie les messages entre les joueurs. Il ne contient aucune logique de jeu :
chaque joueur exécute la même partie, le serveur ne fait que transmettre et ordonner les messages.

```
index.html     le jeu (+ l'adaptateur de salles WebSocket déjà inclus)
server.js      sert index.html et relaie les salles sur /ws
package.json   une seule dépendance : ws
Dockerfile     pour Fly.io, Cloud Run, etc.
render.yaml    déploiement en un clic sur Render
```

## 1. Essayer en local
```bash
npm install
npm start          # http://localhost:3000
```
Ouvrez la page dans deux ou trois onglets : « Create or join a room » dans le premier, puis le code dans les autres.

## 2. Mettre en ligne (le plus simple : tout sur un seul service)
Le serveur sert déjà la page **et** les salles. Il faut un hébergeur qui accepte les WebSockets (HTTPS inclus) :

- **Render** : poussez ce dossier sur GitHub, « New > Web Service », choisissez le dépôt.
  Build : `npm install`, Start : `npm start`. (ou utilisez `render.yaml` via « New > Blueprint »).
- **Railway** : « New Project > Deploy from GitHub », il détecte Node et lance `npm start`.
- **Fly.io** : `fly launch` (le `Dockerfile` est détecté), puis `fly deploy`.
- **VPS** : `npm install && node server.js` derrière un reverse proxy (voir ci-dessous), lancé avec `pm2` ou `systemd`.

Variables d'environnement (facultatives) :
| Variable | Rôle |
|---|---|
| `PORT` | port d'écoute (la plupart des hébergeurs le fournissent) |
| `ALLOWED_ORIGINS` | liste d'origines autorisées pour le WebSocket, séparées par des virgules, ex. `https://mon-jeu.com` |

Nginx (reverse proxy avec WebSocket) :
```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

## 3. Page statique + serveur séparé (Netlify, GitHub Pages, Vercel…)
Hébergez `index.html` où vous voulez et `server.js` ailleurs. Dans `index.html`, ajoutez **avant** le premier `<script>` :
```html
<script>window.BLIDO_WS='wss://votre-serveur.onrender.com/ws'</script>
```
et définissez `ALLOWED_ORIGINS=https://votre-site-statique.com` sur le serveur.
Sans serveur, les trois modes hors ligne fonctionnent quand même.

## Limites actuelles
- Les salles vivent en mémoire : un redémarrage du serveur les vide (les parties en cours sont perdues).
- Une seule instance du serveur (les salles ne sont pas partagées entre plusieurs instances).
- 8 personnes maximum par salle (4 joueurs par partie), 2000 salles, messages de 4 Ko maximum, limitation de débit par connexion.
- Pas de comptes : toute personne qui connaît le code d'une salle peut la rejoindre tant que la partie n'a pas commencé.
- Une partie commencée ne peut pas être rejointe en cours de route ni reprise après une déconnexion longue.
- La voix arabe et les sons ne démarrent qu'après un premier toucher de la page (règle des navigateurs).
