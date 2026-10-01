/**
 * Gate de acceso por contraseña (Netlify Edge Function).
 *
 * Corre antes que cualquier archivo del sitio: si la sesión no está
 * autenticada, devuelve la pantalla de login y nunca llama a next(),
 * así el HTML de la herramienta no llega al navegador.
 *
 * La contraseña se configura como variable de entorno APP_PASSWORD en
 * Netlify (Site settings -> Environment variables). En local, `netlify dev`
 * la toma del archivo .env. Nunca viaja al cliente.
 */

const SESSION_COOKIE = 'tmc_session';
const ATTEMPTS_COOKIE = 'tmc_try';
const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 300; // 5 minutos

const encoder = new TextEncoder();

export default async (request, context) => {
  const password = Netlify.env.get('APP_PASSWORD');
  const url = new URL(request.url);

  if (!password) {
    return htmlResponse(loginPage({ setupError: true }), 500);
  }

  const cookies = parseCookies(request.headers.get('cookie'));

  // Salir: borra la sesión y vuelve a la misma ruta.
  if (url.searchParams.has('logout')) {
    const res = new Response(null, { status: 303, headers: { Location: url.pathname } });
    res.headers.append('Set-Cookie', expireCookie(SESSION_COOKIE));
    res.headers.append('Set-Cookie', expireCookie(ATTEMPTS_COOKIE));
    return res;
  }

  // La sesión se firma con la contraseña: si cambia, las sesiones viejas caen.
  const session = await readSigned(password, cookies[SESSION_COOKIE]);

  if (session !== null && Number(session) > Date.now()) {
    return serveProtected(context);
  }

  const attempts = await readAttempts(password, cookies[ATTEMPTS_COOKIE]);
  let locked = lockRemaining(attempts);
  let error = null;

  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const given = String(form?.get('password') ?? '');

    if (locked > 0) {
      error = lockMessage(locked);
    } else if (await equalsSecret(given, password)) {
      const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
      const token = await sign(password, String(expires));
      const res = new Response(null, { status: 303, headers: { Location: url.pathname } });
      res.headers.append('Set-Cookie', setCookie(SESSION_COOKIE, token, SESSION_DAYS * 86400));
      res.headers.append('Set-Cookie', expireCookie(ATTEMPTS_COOKIE));
      return res;
    } else {
      const next = { count: attempts.count + 1, last: Date.now() };
      locked = lockRemaining(next);
      error = locked > 0 ? lockMessage(locked) : 'Contraseña incorrecta.';
      await delay(400); // freno simple contra fuerza bruta
      const res = htmlResponse(loginPage({ error, locked }), 401);
      res.headers.append(
        'Set-Cookie',
        setCookie(ATTEMPTS_COOKIE, await sign(password, `${next.count}:${next.last}`), LOCK_SECONDS),
      );
      return res;
    }
  } else if (locked > 0) {
    error = lockMessage(locked);
  }

  return htmlResponse(loginPage({ error, locked }), error ? 401 : 200);
};

export const config = { path: '/*' };

/* ---------- contenido protegido ---------- */

async function serveProtected(context) {
  const upstream = await context.next();
  const res = new Response(upstream.body, upstream);
  const type = res.headers.get('content-type') ?? '';

  // Nada de este sitio debe quedar en una caché compartida.
  res.headers.set(
    'Cache-Control',
    type.includes('text/html') ? 'private, no-store' : 'private, max-age=3600',
  );

  return res;
}

/* ---------- firma y comparación ---------- */

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return base64url(new Uint8Array(signature));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return base64url(new Uint8Array(digest));
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Comparación en tiempo constante sobre cadenas del mismo largo. */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compara contraseñas por su hash, para no filtrar el largo por timing. */
async function equalsSecret(given, expected) {
  return constantTimeEquals(await sha256(given), await sha256(expected));
}

async function sign(password, payload) {
  return `${payload}.${await hmac(password, payload)}`;
}

/** Devuelve el payload si la firma es válida, o null. */
async function readSigned(password, token) {
  if (!token) return null;

  const cut = token.lastIndexOf('.');
  if (cut < 1) return null;

  const payload = token.slice(0, cut);
  const signature = token.slice(cut + 1);

  return constantTimeEquals(signature, await hmac(password, payload)) ? payload : null;
}

/* ---------- intentos fallidos ---------- */

async function readAttempts(password, token) {
  const payload = await readSigned(password, token);
  if (payload === null) return { count: 0, last: 0 };

  const [count, last] = payload.split(':');
  return { count: Number(count) || 0, last: Number(last) || 0 };
}

function lockRemaining(attempts) {
  if (attempts.count < MAX_ATTEMPTS) return 0;
  return Math.max(0, LOCK_SECONDS - Math.floor((Date.now() - attempts.last) / 1000));
}

function lockMessage(seconds) {
  return `Demasiados intentos. Probá de nuevo en ${Math.ceil(seconds / 60)} minuto(s).`;
}

/* ---------- helpers HTTP ---------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;

  for (const part of header.split(';')) {
    const cut = part.indexOf('=');
    if (cut < 1) continue;
    out[part.slice(0, cut).trim()] = decodeURIComponent(part.slice(cut + 1).trim());
  }

  return out;
}

function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function expireCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- pantalla de login ---------- */

/**
 * El login no depende de style.css: la edge function bloquea todo el sitio,
 * así que lleva sus propios tokens, los mismos de la herramienta.
 */
function loginPage({ error = null, locked = 0, setupError = false } = {}) {
  const disabled = locked > 0 ? ' disabled' : '';

  const errorBlock = error
    ? `<div class="login-error" role="alert"><span aria-hidden="true">!</span><span>${escapeHtml(error)}</span></div>`
    : '';

  const body = setupError
    ? `<h1>Falta configurar el acceso</h1>
            <p class="sub">Definí la variable de entorno <code>APP_PASSWORD</code> en Netlify
                (Site settings, Environment variables) y volvé a desplegar el sitio.</p>
            <div class="login-error" role="alert">
                <span aria-hidden="true">!</span><span>APP_PASSWORD no está configurada en el servidor.</span>
            </div>`
    : `<h1>Acceso privado</h1>
            <p class="sub">Esta herramienta es del canal de cybernahir. Ingresá la contraseña para entrar.</p>

            <form method="post" novalidate>
                <label for="password">Contraseña</label>
                <div class="pass-row">
                    <input type="password" id="password" name="password" required autofocus
                        autocomplete="current-password" placeholder="Tu contraseña"${disabled} />
                    <button type="button" class="toggle-pass" id="togglePass"
                        aria-label="Mostrar contraseña">Ver</button>
                </div>
                ${errorBlock}
                <button type="submit" class="login-btn"${disabled}>Entrar</button>
            </form>

            <p class="login-foot">La sesión queda abierta ${SESSION_DAYS} días en este navegador.</p>`;

  return `<!DOCTYPE html>
<html lang="es" data-theme="dark">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Acceso privado · Twitch Message Creator</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
        :root {
            --surface: #18181b;
            --surface3: #26262c;
            --border: #3a3a4a;
            --text: #efeff1;
            --text-muted: #adadb8;
            --text-dim: #6e6e83;
            --input-bg: #26262c;
            --purple: #9147ff;
            --purple-h: #a970ff;
        }

        *,
        *::before,
        *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: #0e0e10;
            color: var(--text);
            min-height: 100dvh;
            display: grid;
            place-items: center;
            padding: 24px 16px;
        }

        .login-card {
            width: 100%;
            max-width: 380px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 14px;
            padding: 28px 26px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55);
        }

        .login-brand {
            display: flex;
            align-items: center;
            gap: 9px;
            color: var(--purple);
            font-weight: 700;
            font-size: 0.95rem;
            margin-bottom: 18px;
        }

        .login-card h1 {
            font-size: 1.28rem;
            font-weight: 700;
            line-height: 1.25;
            margin-bottom: 7px;
        }

        .login-card p.sub {
            font-size: 0.86rem;
            color: var(--text-muted);
            line-height: 1.5;
            margin-bottom: 22px;
        }

        .login-card label {
            display: block;
            font-size: 0.8rem;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 6px;
        }

        .pass-row {
            display: flex;
            gap: 8px;
        }

        .login-card input[type='password'],
        .login-card input[type='text'] {
            flex: 1;
            min-width: 0;
            background: var(--input-bg);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text);
            font-family: inherit;
            font-size: 0.92rem;
            padding: 11px 13px;
            transition: border-color 0.15s;
        }

        .login-card input:focus-visible {
            outline: none;
            border-color: var(--purple);
            box-shadow: 0 0 0 3px rgba(145, 71, 255, 0.28);
        }

        .toggle-pass {
            background: var(--surface3);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text-muted);
            font-family: inherit;
            font-size: 0.78rem;
            font-weight: 600;
            padding: 0 13px;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
        }

        .toggle-pass:hover {
            background: var(--border);
            color: var(--text);
        }

        .toggle-pass:focus-visible {
            outline: 2px solid var(--purple);
            outline-offset: 2px;
        }

        .login-error {
            display: flex;
            gap: 7px;
            align-items: flex-start;
            font-size: 0.82rem;
            line-height: 1.45;
            color: #ff9a9a;
            margin-top: 10px;
        }

        .login-btn {
            width: 100%;
            margin-top: 20px;
            background: var(--purple);
            border: none;
            border-radius: 8px;
            color: #ffffff;
            font-family: inherit;
            font-size: 0.93rem;
            font-weight: 600;
            padding: 12px 16px;
            cursor: pointer;
            transition: background 0.15s, transform 0.1s;
        }

        .login-btn:hover {
            background: var(--purple-h);
        }

        .login-btn:active {
            transform: translateY(1px);
        }

        .login-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .login-foot {
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--border);
            font-size: 0.76rem;
            color: var(--text-dim);
            line-height: 1.55;
        }

        .login-card code {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            color: var(--text-muted);
        }
    </style>
</head>

<body>
    <main class="login-card">
        <div class="login-brand">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4 2L2 6v14h5v3l3-3h4l6-6V2H4zm15 11l-3 3h-4l-3 3v-3H5V4h14v9z" />
                <rect x="10" y="7" width="2" height="5" />
                <rect x="15" y="7" width="2" height="5" />
            </svg>
            Twitch Message Creator
        </div>

        ${body}
    </main>

    <script>
        const toggle = document.getElementById('togglePass');
        if (toggle) {
            const input = document.getElementById('password');
            toggle.addEventListener('click', () => {
                const shown = input.type === 'text';
                input.type = shown ? 'password' : 'text';
                toggle.textContent = shown ? 'Ver' : 'Ocultar';
                toggle.setAttribute('aria-label', shown ? 'Mostrar contraseña' : 'Ocultar contraseña');
                input.focus();
            });
        }
    </script>
</body>

</html>`;
}
