interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  PASSWORD_SHIROE: string;
  PASSWORD_VIVI: string;
  SESSION_SECRET: string;
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  TWITCH_EVENTSUB_SECRET: string;
}

type AccountId = "panszczesniak" | "shiroe" | "vivi";
type Account = { id: AccountId; label: string; channels: "all" | string[] };
const ACCOUNTS: Record<AccountId, { label: string; passwordEnv: "ADMIN_PASSWORD" | "PASSWORD_SHIROE" | "PASSWORD_VIVI"; channels: "all" | string[] }> = {
  panszczesniak: { label: "PanSzczesniak (admin)", passwordEnv: "ADMIN_PASSWORD", channels: "all" },
  shiroe: { label: "Shiroe_com", passwordEnv: "PASSWORD_SHIROE", channels: ["shiroe_com"] },
  vivi: { label: "ViviOnyx", passwordEnv: "PASSWORD_VIVI", channels: ["vivionyxx"] }
};
function canAccess(account: Account, login: string) {
  return account.channels === "all" || account.channels.includes(login);
}

type Channel = {
  twitch_login: string; enabled: number; role_id: string; message_text: string;
  banner_key: string | null; webhook_url: string; color: number;
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8" }
});
const encoder = new TextEncoder();

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function cookie(request: Request, name: string) {
  return request.headers.get("Cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="))?.slice(name.length + 1);
}
async function getAccount(request: Request, env: Env): Promise<Account | null> {
  const value = cookie(request, "stream_pings_session");
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot) as AccountId;
  const hash = value.slice(dot + 1);
  const config = ACCOUNTS[id];
  if (!config) return null;
  if (!same(hash, await sha256(id + ":" + env.SESSION_SECRET))) return null;
  return { id, label: config.label, channels: config.channels };
}
function html(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });
}
function loginPage(error = "") {
  const options = Object.entries(ACCOUNTS).map(([id, a]) => `<option value="${id}">${a.label}</option>`).join("");
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stream Pings</title><style>${styles}</style><main class="login"><h1>Stream Pings</h1><p>Panel administracyjny</p>${error ? `<p class="error">${error}</p>` : ""}<form method="post" action="/login"><label>Konto<select name="login">${options}</select></label><label>Hasło<input required type="password" name="password" autofocus></label><button>Zaloguj się</button></form></main></html>`;
}

async function twitchToken(env: Env) {
  const form = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: "client_credentials" });
  const response = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body: form });
  if (!response.ok) throw new Error("Nie udało się pobrać tokenu Twitch.");
  return (await response.json() as { access_token: string }).access_token;
}
async function twitchStream(login: string, env: Env) {
  const token = await twitchToken(env);
  const response = await fetch("https://api.twitch.tv/helix/streams?user_login=" + encodeURIComponent(login), {
    headers: { "Client-Id": env.TWITCH_CLIENT_ID, Authorization: "Bearer " + token }
  });
  if (!response.ok) throw new Error("Twitch API zwróciło błąd.");
  const data = await response.json() as { data: Array<{title: string; game_name: string; viewer_count: number; thumbnail_url: string; user_login: string; user_name: string}> };
  return data.data[0] ?? null;
}
async function subscribeToTwitch(login: string, callback: string, env: Env) {
  const token = await twitchToken(env);
  const userResponse = await fetch("https://api.twitch.tv/helix/users?login=" + encodeURIComponent(login), { headers: { "Client-Id": env.TWITCH_CLIENT_ID, Authorization: "Bearer " + token } });
  const user = (await userResponse.json() as { data: Array<{ id: string }> }).data[0];
  if (!user) throw new Error(`Nie znaleziono kanału Twitch: ${login}`);
  const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", { method: "POST", headers: { "Client-Id": env.TWITCH_CLIENT_ID, Authorization: "Bearer " + token, "content-type": "application/json" }, body: JSON.stringify({ type: "stream.online", version: "1", condition: { broadcaster_user_id: user.id }, transport: { method: "webhook", callback, secret: env.TWITCH_EVENTSUB_SECRET } }) });
  if (response.status === 409) return;
  if (!response.ok) throw new Error(`Twitch nie utworzył subskrypcji dla ${login}.`);
}
async function hmacHex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function discord(channel: Channel, origin: string, stream: Awaited<ReturnType<typeof twitchStream>>, test = false) {
  if (!channel.webhook_url) throw new Error("Brakuje webhooka Discord dla tego kanału.");
  const target = channel.webhook_url + (channel.webhook_url.includes("?") ? "&" : "?") + "wait=true";
  const role = channel.role_id ? `<@&${channel.role_id}>` : "";
  const mention = channel.role_id ? { parse: [], roles: [channel.role_id] } : { parse: [] };
  if (channel.banner_key) {
    await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      content: role, allowed_mentions: mention, embeds: [{ image: { url: `${origin}/assets/${encodeURIComponent(channel.banner_key)}` }, color: channel.color }]
    }) });
  }
  const title = stream?.title ?? (test ? "To jest wiadomość testowa" : "Stream trwa");
  const game = stream?.game_name || "Just Chatting";
  const viewers = stream?.viewer_count ?? 0;
  const thumbnail = stream?.thumbnail_url.replace("{width}", "1280").replace("{height}", "720");
  const login = stream?.user_login ?? channel.twitch_login;
  const payload = {
    allowed_mentions: { parse: [] },
    embeds: [{
      author: { name: stream?.user_name ?? channel.twitch_login }, title,
      url: `https://www.twitch.tv/${login}`, description: channel.message_text,
      color: channel.color,
      fields: [{ name: "Kategoria", value: game, inline: true }, { name: "Widzowie", value: String(viewers), inline: true }],
      ...(thumbnail ? { image: { url: thumbnail } } : {})
    }],
    components: [{ type: 1, components: [{ type: 2, style: 5, label: "Oglądaj teraz", url: `https://www.twitch.tv/${login}` }] }]
  };
  const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error("Discord odrzucił wiadomość (sprawdź webhook i uprawnienia roli).");
}

async function adminApp(request: Request, env: Env) {
  const account = await getAccount(request, env);
  if (!account) return new Response(null, { status: 302, headers: { Location: "/login" } });
  return html(adminPage(account));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/assets/")) {
      const banner = await env.DB.prepare("SELECT content, content_type FROM banners WHERE banner_key=?").bind(decodeURIComponent(url.pathname.slice(8))).first<{ content: ArrayBuffer; content_type: string }>();
      return banner ? new Response(banner.content, { headers: { "content-type": banner.content_type, "cache-control": "public, max-age=300" } }) : new Response("Nie znaleziono grafiki", { status: 404 });
    }
    if (url.pathname === "/eventsub" && request.method === "POST") return handleEventSub(request, env);
    if (url.pathname === "/login" && request.method === "GET") return html(loginPage());
    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const id = String(form.get("login") ?? "") as AccountId;
      const config = ACCOUNTS[id];
      const password = String(form.get("password") ?? "");
      if (!config || !same(password, env[config.passwordEnv] ?? "")) return html(loginPage("Nieprawidłowe konto lub hasło."), 401);
      return new Response(null, { status: 302, headers: { Location: "/admin", "Set-Cookie": `stream_pings_session=${id}.${await sha256(id + ":" + env.SESSION_SECRET)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000` } });
    }
    if (url.pathname === "/logout") return new Response(null, { status: 302, headers: { Location: "/login", "Set-Cookie": "stream_pings_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0" } });
    if (url.pathname === "/" || url.pathname === "/admin") return adminApp(request, env);
    if (!url.pathname.startsWith("/api/")) return new Response("Nie znaleziono", { status: 404 });
    const account = await getAccount(request, env);
    if (!account) return json({ error: "Brak dostępu" }, 401);
    if (url.pathname === "/api/me" && request.method === "GET") return json({ id: account.id, label: account.label, channels: account.channels });
    if (url.pathname === "/api/channels" && request.method === "GET") {
      const rows = (await env.DB.prepare("SELECT twitch_login, enabled, role_id, message_text, banner_key, color, CASE WHEN webhook_url <> '' THEN 1 ELSE 0 END AS has_webhook FROM channels ORDER BY twitch_login").all<{ twitch_login: string }>()).results;
      return json(rows.filter(r => canAccess(account, r.twitch_login)));
    }
    if (url.pathname === "/api/connect-twitch" && request.method === "POST") {
      if (account.channels !== "all") return json({ error: "Brak dostępu" }, 403);
      try {
        const active = (await env.DB.prepare("SELECT twitch_login FROM channels WHERE enabled=1").all<{ twitch_login: string }>()).results;
        for (const row of active) await subscribeToTwitch(row.twitch_login, url.origin + "/eventsub", env);
        return json({ ok: true });
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Błąd Twitch" }, 400); }
    }
    const match = url.pathname.match(/^\/api\/channels\/([a-z0-9_]+)(\/banner|\/test)?$/i);
    if (!match) return json({ error: "Nie znaleziono" }, 404);
    const login = match[1].toLowerCase();
    if (!canAccess(account, login)) return json({ error: "Brak dostępu do tego kanału" }, 403);
    const channel = await env.DB.prepare("SELECT * FROM channels WHERE twitch_login = ?").bind(login).first<Channel>();
    if (!channel) return json({ error: "Nie znaleziono kanału" }, 404);
    if (match[2] === "/banner" && request.method === "POST") {
      const form = await request.formData(), file = form.get("banner");
      if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) return json({ error: "Wgraj obraz do 8 MB." }, 400);
      const key = `${login}-${crypto.randomUUID()}.${file.name.split(".").pop()?.toLowerCase() || "png"}`;
      await env.DB.prepare("INSERT INTO banners(banner_key, content, content_type) VALUES (?, ?, ?)").bind(key, await file.arrayBuffer(), file.type).run();
      if (channel.banner_key) await env.DB.prepare("DELETE FROM banners WHERE banner_key=?").bind(channel.banner_key).run();
      await env.DB.prepare("UPDATE channels SET banner_key=?, updated_at=CURRENT_TIMESTAMP WHERE twitch_login=?").bind(key, login).run();
      return json({ ok: true, banner_key: key });
    }
    if (match[2] === "/test" && request.method === "POST") {
      try { await discord(channel, url.origin, await twitchStream(login, env), true); return json({ ok: true }); } catch (error) { return json({ error: error instanceof Error ? error.message : "Błąd" }, 400); }
    }
    if (!match[2] && request.method === "PUT") {
      const body = await request.json() as Partial<Channel>;
      const role = String(body.role_id ?? "").trim(), webhook = String(body.webhook_url ?? "").trim();
      if (role && !/^\d{17,20}$/.test(role)) return json({ error: "ID roli powinno składać się z 17–20 cyfr." }, 400);
      if (webhook && !/^https:\/\/((canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/.+/.test(webhook)) return json({ error: "To nie wygląda na URL webhooka Discord." }, 400);
      await env.DB.prepare("UPDATE channels SET enabled=?, role_id=?, message_text=?, webhook_url=?, color=?, updated_at=CURRENT_TIMESTAMP WHERE twitch_login=?").bind(body.enabled ? 1 : 0, role, String(body.message_text ?? "").slice(0, 2000), webhook || channel.webhook_url, Number(body.color) || 10181046, login).run();
      return json({ ok: true });
    }
    return json({ error: "Nieobsługiwana operacja" }, 405);
  }
} satisfies ExportedHandler<Env>;

async function handleEventSub(request: Request, env: Env) {
  const raw = await request.text();
  const id = request.headers.get("Twitch-Eventsub-Message-Id") ?? "";
  const timestamp = request.headers.get("Twitch-Eventsub-Message-Timestamp") ?? "";
  const signature = request.headers.get("Twitch-Eventsub-Message-Signature") ?? "";
  if (!same(signature, "sha256=" + await hmacHex(env.TWITCH_EVENTSUB_SECRET, id + timestamp + raw))) return new Response("Nieprawidłowy podpis", { status: 403 });
  const type = request.headers.get("Twitch-Eventsub-Message-Type");
  const body = JSON.parse(raw);
  if (type === "webhook_callback_verification") return new Response(body.challenge, { headers: { "content-type": "text/plain" } });
  if (type !== "notification" || body.subscription?.type !== "stream.online") return new Response("OK");
  const seen = await env.DB.prepare("INSERT OR IGNORE INTO received_events(event_id) VALUES(?)").bind(id).run();
  if (!seen.meta.changes) return new Response("OK");
  const login = String(body.event?.broadcaster_user_login ?? "").toLowerCase();
  const channel = await env.DB.prepare("SELECT * FROM channels WHERE twitch_login=? AND enabled=1").bind(login).first<Channel>();
  if (channel) await discord(channel, new URL(request.url).origin, await twitchStream(login, env));
  return new Response("OK");
}

const styles = `*{box-sizing:border-box}body{margin:0;background:#000000;color:#f2f2f2;font:16px "Segoe UI",system-ui,sans-serif}main{max-width:980px;margin:auto;padding:32px 20px}.login{max-width:420px;margin:12vh auto}.login form,.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:20px}h1{color:#f2f2f2;letter-spacing:.2px;margin:0}label{display:block;font-weight:600;margin:10px 0;color:#f2f2f2}input,textarea,select{display:block;width:100%;margin-top:7px;padding:10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:#0d0d0f;color:#f2f2f2;font:inherit}input:focus,textarea:focus,select:focus{outline:none;border-color:#E3C048}textarea{min-height:85px;resize:vertical}button{border:0;border-radius:6px;background:#E3C048;color:#14120a;font-weight:700;padding:10px 14px;cursor:pointer;margin:5px 6px 0 0;transition:background .15s ease}button:hover{background:#43fbff}.secondary{background:rgba(255,255,255,.08);color:#f2f2f2}.secondary:hover{background:rgba(255,255,255,.16)}.danger{background:#b42318;color:#fff}.danger:hover{background:#d1281c}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card h2{text-transform:none;margin-top:0;color:#E3C048;font-weight:700}.top{display:flex;align-items:center;justify-content:space-between;gap:10px}.hint{color:#9a9a9a;font-size:.9rem}.error{color:#ff9b9b}.ok{color:#92f0a6}.banner{width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin:8px 0}`;
const adminPage = (account: Account) => `<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stream Pings</title><style>${styles}</style><main><div class="top"><div><h1>Powiadomienia streamów</h1><p class="hint">Zalogowano jako: ${account.label}. Edytuj treść, role i banery. Zmiany zapisują się od razu.</p></div><div>${account.channels === "all" ? `<button id="connect" class="secondary">Podłącz Twitch</button>` : ""}<a href="/logout"><button class="secondary">Wyloguj</button></a></div></div><p id="status" class="hint"></p><section id="channels" class="grid"></section></main><script>
const el=document.querySelector('#channels'),status=document.querySelector('#status');let channels=[];
const esc=s=>String(s??'').replace(/[&<>\"]/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[x]));
async function api(url,opt){const r=await fetch(url,opt);const d=await r.json();if(!r.ok)throw Error(d.error||'Błąd');return d}
function render(){el.innerHTML=channels.map(c=>\`<article class="card"><h2>\${esc(c.twitch_login)}</h2><label><input data-f="enabled" type="checkbox" \${c.enabled?'checked':''}> Powiadomienia aktywne</label><label>ID roli<input data-f="role_id" inputmode="numeric" value="\${esc(c.role_id)}" placeholder="np. 123456789012345678"></label><label>Tekst<input data-f="message_text" value="\${esc(c.message_text)}"></label><label>Kolor embeda<input data-f="color" type="color" value="#\${Number(c.color).toString(16).padStart(6,'0')}"></label><label>Webhook Discorda<input data-f="webhook_url" type="password" placeholder="\${c.has_webhook?'zapisany — wpisz tylko aby zmienić':'https://discord.com/api/webhooks/...'}"></label>\${c.banner_key?\`<img class="banner" src="/assets/\${encodeURIComponent(c.banner_key)}">\`:''}<label>Grafika nad embedem<input data-f="banner" type="file" accept="image/png,image/jpeg,image/webp"></label><button data-a="save">Zapisz</button><button class="secondary" data-a="test">Wyślij test</button></article>\`).join('')}
el.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const card=b.closest('.card'),c=channels[[...el.children].indexOf(card)];try{if(b.dataset.a==='save'){const get=f=>card.querySelector('[data-f="'+f+'"]').value;await api('/api/channels/'+c.twitch_login,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:card.querySelector('[data-f="enabled"]').checked,role_id:get('role_id'),message_text:get('message_text'),webhook_url:get('webhook_url'),color:parseInt(get('color').slice(1),16)})});const file=card.querySelector('[data-f="banner"]').files[0];if(file){const f=new FormData();f.append('banner',file);await api('/api/channels/'+c.twitch_login+'/banner',{method:'POST',body:f})}status.textContent='Zapisano.';await load()}else{status.textContent='Wysyłam…';await api('/api/channels/'+c.twitch_login+'/test',{method:'POST'});status.textContent='Wysłano test.'}}catch(x){status.textContent=x.message;status.className='error'}})
document.querySelector('#connect')?.addEventListener('click',async()=>{try{status.textContent='Łączę kanały z Twitchem…';await api('/api/connect-twitch',{method:'POST'});status.textContent='Twitch został podłączony.'}catch(x){status.textContent=x.message;status.className='error'}})
async function load(){channels=await api('/api/channels');render()}load();</script></html>`;
