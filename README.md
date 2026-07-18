# Stream Pings

Własny panel powiadomień Twitch → Discord dla kanałów `ViviOnyx`, `Shiroe_com` i `PanSzczesniak`.

## Wdrożenie

1. Utwórz D1 o nazwie `stream-pings-db` i wykonaj w nim zawartość `schema.sql`.
2. Połącz to repozytorium z Cloudflare Workers. Build command: `npm install`; Deploy command: `npx wrangler deploy`.
3. W Workerze dodaj binding D1 jako `DB`.
4. Dodaj sekrety: `ADMIN_PASSWORD`, `SESSION_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_EVENTSUB_SECRET`.

Sekretów nie wolno dodawać do GitHuba.
