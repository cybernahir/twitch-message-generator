# Twitch Message Creator

Generador de mensajes de chat de Twitch para el canal de **cybernahir**.

Es una web estática (HTML + CSS + JS, sin build ni dependencias que instalar) que permite armar
un mensaje idéntico a los que aparecen en el chat de Twitch —con nombre de usuario, color,
insignias y emotes del canal— y descargarlo como imagen PNG lista para usar en redes,
miniaturas, overlays o clips.

La herramienta es privada: una edge function de Netlify pide una contraseña antes de servir
cualquier archivo del sitio. Ver [Acceso con contraseña](#acceso-con-contraseña).

---

## Características

- **Nombre de usuario personalizable**, con vista previa en tiempo real.
- **Color del nombre**: paleta de 10 colores predefinidos (los típicos de Twitch), campo hexadecimal manual y selector de color nativo. Los tres inputs quedan sincronizados entre sí.
- **Insignias (badges)**: se activan/desactivan con un clic y se renderizan a la izquierda del nombre.
  - Insignias globales de Twitch: Streamer, Mod, VIP, Sub, Fundador, Partner, Prime, Staff, Bits, Artista y Super Mod (imágenes servidas desde el CDN oficial de Twitch).
  - Insignias de suscripción propias del canal (`icons-sub/`): 0, 2, 3, 6, 9, 12, 18, 24, 30 y 36 meses.
- **Emotes**: al escribir el nombre de un emote en el mensaje, éste se reemplaza automáticamente por su imagen o emoji.
  - Emotes propios del canal: `cyberNahirCool`, `cyberNahirMueve` (imágenes reales desde el CDN de Twitch).
  - Emotes globales/clásicos mapeados a emoji: `Kappa`, `4Head`, `OMEGALUL`, `PepeHands`, `Sadge`, `monkaS`, `EZ`, `HeyGuys`, `BibleThump`, `ResidentSleeper`, `FeelsBadMan`, `FeelsGoodMan`, `DansGame`.
- **Modo claro / oscuro**, con la paleta de colores de Twitch en ambos temas.
- **Descarga en PNG** del mensaje renderizado, capturado con `html2canvas` a escala 3x (alta resolución).
- **Diseño responsive**: en pantallas menores a 780px la vista previa pasa arriba del formulario.

---

## Cómo usarlo

No requiere instalación ni servidor de build. Para trabajar en la herramienta alcanza con
cualquier servidor estático; para probar además el login hace falta la CLI de Netlify.

### Opción 1 — Live Server (VS Code)

El proyecto ya trae la configuración en [.vscode/settings.json](.vscode/settings.json) (puerto `5501`):

1. Instalar la extensión **Live Server**.
2. Clic derecho sobre `index.html` → *Open with Live Server*.

El gate no corre acá: Live Server sirve los archivos directo, sin pedir contraseña. Sirve para
maquetar, no para probar el acceso.

### Opción 2 — XAMPP / Apache

Ubicar la carpeta dentro de `htdocs` y entrar a `http://localhost/cybernahir/twitch-message-generator/`.
Tampoco corre el gate.

### Opción 3 — Netlify CLI (el gate incluido)

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` levanta el sitio con la edge function y toma la contraseña del archivo `.env`,
así que es la forma de probar el login tal como va a funcionar en producción.

> **Nota:** conviene servirlo por HTTP y no abrir el `index.html` directamente con `file://`,
> porque `html2canvas` necesita cargar las imágenes de las insignias y emotes con CORS
> para poder incluirlas en el PNG.

### Flujo de uso

1. Entrar con la contraseña.
2. Escribir el nombre de usuario.
3. Elegir el color del nombre (paleta, hex o color picker).
4. Escribir el mensaje. Si incluye el nombre de un emote soportado, se convierte solo.
5. Activar las insignias que correspondan.
6. Revisar la vista previa y presionar **Descargar mensaje (.png)**.

---

## Acceso con contraseña

La página no muestra nada hasta que se ingresa la contraseña correcta.

### Configurarla en Netlify (producción)

1. En el panel del sitio: **Site configuration → Environment variables → Add a variable**.
2. Key `APP_PASSWORD`, value la contraseña que quieras.
3. Volver a desplegar (**Deploys → Trigger deploy**) para que la edge function tome el valor.

Para cambiarla, se edita la variable y se vuelve a desplegar. Al cambiarla, las sesiones ya
abiertas dejan de valer automáticamente y hay que entrar de nuevo.

### Configurarla en local

Crear el archivo `.env` en la raíz del proyecto (se puede copiar `.env.example`) con la misma
línea. `netlify dev` lo lee solo:

```ini
APP_PASSWORD=la-contraseña-que-quieras
```

El `.env` está en [.gitignore](.gitignore), así que no se sube al repo ni a Netlify.

### Cómo funciona

- [netlify/edge-functions/auth.js](netlify/edge-functions/auth.js) está declarada en
  [netlify.toml](netlify.toml) sobre la ruta `/*`, así que corre **antes** de servir cualquier
  archivo. Si la sesión no está autenticada, devuelve la pantalla de login y nunca llama a
  `next()`: el HTML de la herramienta no llega al navegador. Las imágenes y el CSS también
  quedan detrás del gate.
- La contraseña vive solo en la variable de entorno. No viaja al cliente ni queda en el JS, y la
  comparación se hace sobre hashes para no filtrar el largo por timing.
- La sesión es una cookie `HttpOnly` firmada con HMAC-SHA256, válida 30 días. La clave de la
  firma es la propia contraseña: por eso cambiarla invalida las sesiones viejas. El botón
  **Salir** del header la borra.
- Las respuestas protegidas salen con `Cache-Control: private`, para que la CDN no guarde una
  copia del contenido y se la sirva a alguien sin sesión.
- La pantalla de login no depende de `style.css` (que también está bloqueado): lleva sus propios
  estilos, los mismos de la herramienta.

> **Sobre el límite de intentos:** después de 5 intentos fallidos el formulario se bloquea 5
> minutos, pero ese contador vive en una cookie firmada. Frena a alguien probando a mano en su
> navegador; no frena a quien borre las cookies entre intento e intento. En las edge functions
> no hay estado compartido donde llevar la cuenta de verdad, así que la defensa real es que la
> contraseña sea larga. Si llega a hacer falta un límite serio, se puede agregar con Netlify
> Blobs.

---

## Despliegue en Netlify

1. Subir el repo a GitHub.
2. En Netlify: **Add new site → Import an existing project**, y elegir el repo.
3. Dejar el build command vacío y el publish directory en `.` (ya está en
   [netlify.toml](netlify.toml)).
4. Cargar la variable `APP_PASSWORD` antes del primer deploy, o volver a desplegar después de
   cargarla.

Netlify detecta la edge function sola por estar en `netlify/edge-functions/`. No hay build ni
dependencias que instalar.

---

## Estructura del proyecto

```
twitch-message-generator/
├── index.html          # Markup + toda la lógica JS (badges, emotes, render y captura)
├── netlify.toml        # Publish directory y ruta de la edge function
├── netlify/
│   └── edge-functions/
│       └── auth.js     # Gate: login, cookie de sesión y pantalla de acceso
├── .env                # Contraseña para `netlify dev` (no se versiona)
├── .env.example        # Plantilla del .env
├── style.css           # Estilos y variables de tema (claro/oscuro)
├── favicon.ico
├── icons-sub/          # Insignias de suscripción del canal (0 a 36 meses)
│   ├── 0_meses.png
│   ├── 2_meses.png
│   └── ...
└── .vscode/
    └── settings.json   # Puerto de Live Server
```

---

## Detalles técnicos

- **Sin dependencias locales.** La única librería externa es
  [html2canvas 1.4.1](https://html2canvas.hertzen.com/), cargada por CDN, y la tipografía
  **Inter** desde Google Fonts.
- **Renderizado**: la función `render()` reconstruye el HTML del mensaje en cada `input`,
  escapando el texto del usuario (`escHtml`) antes de reemplazar los emotes, para evitar
  inyección de HTML.
- **Captura**: `capture()` espera a que todas las imágenes del mensaje terminen de cargar y
  luego llama a `html2canvas` con `scale: 3` y `useCORS: true` sobre el nodo `#msgRender`,
  que es el único elemento que se exporta.
- **Temas**: se manejan con el atributo `data-theme` en `<html>` y variables CSS
  (`--bg`, `--surface`, `--chat-bg`, `--purple`, etc.).

### Cómo agregar contenido

- **Un emote nuevo**: agregarlo al objeto `EMOTES` en `index.html`. El valor puede ser la URL
  del emote en el CDN de Twitch o directamente un emoji.
- **Una insignia nueva**: agregar una entrada `{ id, label, img }` al array `BADGES`.
  Para insignias del canal, dejar el PNG en `icons-sub/` y apuntar `img` a esa ruta.
- **Un color de la paleta**: agregarlo al array `PRESET_COLORS`.

---

## Funcionalidad presente pero desactivada

En el código hay dos features implementadas que hoy no están visibles en la interfaz.
Se dejan documentadas por si se quieren reactivar:

- **Selector de fondo del mensaje** (`#bgStyle`): permite elegir entre fondo tipo chat de Twitch,
  negro `#0e0e10`, transparente (con checkerboard), blanco o un color personalizado.
  Está oculto con un `display: none` en el contenedor dentro de [index.html](index.html).
- **Copiar al portapapeles** (`copyMsg()`): copia el PNG directamente al portapapeles mediante
  la Clipboard API. La función y su estilo (`.copy-btn`) existen, pero falta el botón en el HTML.

---

## Créditos

Hecho por **cyberteo19** para el canal de **cybernahir**.

Las insignias y emotes globales se cargan desde el CDN oficial de Twitch
(`static-cdn.jtvnw.net`) y son propiedad de Twitch. Este proyecto no está afiliado ni
respaldado por Twitch.
