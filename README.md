# Crawley CRM

A real estate CRM that runs as a web page and keeps every piece of your data in
your own Google account. No subscription, no third-party server, no vendor holding
your client list.

Built for Laura Crawley, Century 21 Masters — Edmonton, AB.

---

## What it does

**Kanban pipeline, Pipedrive-style.** Two boards — Buyer and Seller — with deals as
cards you drag between stages. Cards show the contact, the value, how long they've
been sitting, and the next thing scheduled. Anything untouched for 14 days gets
flagged so it can't quietly die in a column.

**Contacts** with full history — every call, showing, email and note against the
person and against the deal.

**Gmail.** Pull up recent email threads with a contact on their card, or send them
an email from inside the CRM. It lands in your normal Sent folder.

**Calendar.** Book a showing, listing appointment or closing from a deal card and
it appears on your real Google Calendar — which means it's already on your phone.

**Drive.** Each deal gets its own folder in your Drive. Upload the listing
agreement, the offer, the disclosures; they open in Drive like any other file.

**Dashboard.** Open deals, pipeline value, what's closing this month, what's
stalled, and who you haven't spoken to in a month.

**Works on your phone.** It's a web page, so it just opens. Add it to your home
screen and it behaves like an installed app.

---

## Where your data lives

| What | Where |
|---|---|
| Contacts, deals, activity | A Google Sheet called **Laura CRM Data** in your Drive |
| Documents | A folder called **Laura CRM Documents** in your Drive |
| Emails | Your Gmail, untouched — the CRM only reads and sends |
| Appointments | Your Google Calendar |

There is no other database. Nothing is stored on any server that isn't Google's,
and nothing is stored by whoever hosts the page. You can open that spreadsheet and
edit it by hand any time — the Settings tab has a direct link to it.

---

## Setting it up

See **[SETUP.md](SETUP.md)**. About 25 minutes, once.

Short version: put these files on GitHub Pages (free), create a Google Cloud OAuth
Client ID (free), paste that ID into `js/config.js`, sign in.

---

## The files

```
index.html          the page itself
manifest.json       lets it install to a phone home screen
css/styles.css      all styling
js/config.js        >>> the only file you edit: your Client ID and preferences
js/google.js        auth, Sheets, Gmail, Calendar, Drive
js/store.js         the data model and saving
js/ui.js            small helpers — modals, toasts, formatting
js/app.js           the board, the drawers, all the actions
icons/              app icons
test/               a browser test harness with fake data (not used in production)
```

## Changing things later

**Pipeline stages** — Settings tab in the app. Rename, reorder, add, remove. Deals
sitting in a stage you delete get moved to the first stage, and it asks first.

**Stale threshold, spreadsheet name** — `js/config.js`.

**Contact types, lead sources, activity types** — `DEFAULT_SETTINGS` in
`js/config.js`. These only apply to a brand new setup; once your Settings tab exists
in the spreadsheet, edit it there.

## Running it locally

OAuth needs a real web address, so opening `index.html` by double-clicking won't
work. From this folder:

```bash
python3 -m http.server 8000
```

Then add `http://localhost:8000` as an Authorized JavaScript origin alongside your
GitHub one, and open `http://localhost:8000`.

## Tests

```bash
node test/run.js
```

Loads the app against a mocked Google layer and exercises the board, search,
pipeline switching, drawers, stage moves, forms, dashboard and settings. No network,
no real account touched.
