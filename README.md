# BigHub

BigHub is a prototype internal communication hub for Bigfile.

## MVP scope

- Feed-style posts
- Post types: general, notice, mission, question
- Text-only posts render as thread-style cards
- Posts with media or attachments render as feed media cards
- Like and completion reactions
- Comments
- Search
- Basic progress dashboard
- Local demo persistence with localStorage

## Current stack

- Static HTML
- CSS
- Vanilla JavaScript
- Node test runner for state logic

## Run locally

Open `index.html` in a browser.

## Verify

```bash
node --test app-state.test.js
node --check app-state.js
node --check app.js
```

## Planned integrations

- Supabase Auth and database
- Google Drive file storage through a backend API
- Vercel test deployment
- Tauri desktop packaging
