# Chat widget — setup

Two pieces:

- **`server.js`** — your backend. Holds the real Gemini key. Deploy this somewhere.
- **`widget.js`** — the public, embeddable script. Contains no secrets. Gets served
  by your backend at `/widget.js`.

## 1. Get a fresh Gemini key

Go to https://aistudio.google.com/apikey and create a new key.
(If you're reusing the one pasted earlier in chat — don't. Delete it and make a new one.)

## 2. Run it locally first

```bash
cd widget-backend
cp .env.example .env
# edit .env and paste your key into GEMINI_API_KEY
npm install
npm start
```

You should see:

```
Chat widget backend running on port 3000
Widget file:  http://localhost:3000/widget.js
Chat API:     http://localhost:3000/api/chat
```

Test it by adding this to any local HTML file and opening it in a browser:

```html
<script src="http://localhost:3000/widget.js" async></script>
```

A chat bubble should appear bottom-right.

## 3. Deploy the backend somewhere it can stay running

Any of these work well for a prototype and have free tiers:

- **Render** (render.com) — connect your repo, set the `GEMINI_API_KEY` env var
  in the dashboard, deploy. Easiest for a first deploy.
- **Railway** (railway.app) — similar, very quick.
- **Fly.io** — `fly launch`, then `fly secrets set GEMINI_API_KEY=...`.

Whichever you pick: set the environment variables from `.env.example` in that
platform's dashboard/secrets manager — never commit the real `.env` file.

Once deployed you'll have a URL like `https://your-app-name.onrender.com`.

## 4. Lock down ALLOWED_ORIGIN

Once you know your real landing page domain, set:

```
ALLOWED_ORIGIN=https://www.your-landing-page.com
```

Leaving it as `*` means any website could point at your backend and spend
your Gemini quota.

## 5. Add the script tag to your landing page

```html
<script
  src="https://your-app-name.onrender.com/widget.js"
  data-key="landing-page-v1"
  data-title="Chat with us"
  data-greeting="Hi! Got questions about AI Sales Engine?"
  async
></script>
```

- `data-key` is just a public label (useful later if you run the widget on
  more than one page/site and want to tell them apart) — it is never sent to
  Gemini and is not a secret.
- The widget automatically calls back to the same domain it was loaded from
  for `/api/chat`, so you don't need to configure the endpoint separately
  unless you're hosting `widget.js` and the API on different domains — in
  that case add `data-endpoint="https://your-backend-domain/api/chat"`.

## Notes on this prototype

- Conversation history is kept in memory in the browser tab only — it resets
  on page reload. Fine for a prototype; add a database if you want persistence.
- The in-memory rate limiter resets if the server restarts and won't work
  correctly across multiple server instances — replace with Redis-backed
  rate limiting before serious production traffic.
- `SYSTEM_PROMPT` in `.env` is where you tell the assistant what to say about
  your actual product — the default is generic on purpose.
