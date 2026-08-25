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

**Contacts, live from Google.** Your Google Contacts is the master address book —
names, phones, emails and addresses are read fresh every time, so a number you
fix on your phone is right here too. The CRM adds its own layer on top: type,
source, tags, notes, last contacted, and every deal. Add someone here and they
appear in your Google Contacts; edit either side and they stay in step. The
Contacts tab has a "My CRM" / "All Google Contacts" switch so you can browse the
whole address book and pull people into the pipeline one at a time.

**Gmail.** Pull up recent email threads with a contact on their card, or send them
an email from inside the CRM. It lands in your normal Sent folder.

**Calendar.** Book a showing, listing appointment or closing from a deal card and
it appears on your real Google Calendar — which means it's already on your phone.

**Drive.** Each deal gets its own folder in your Drive. Upload the listing
agreement, the offer, the disclosures; they open in Drive like any other file.

**Dashboard.** A goal-vs-actual scoreboard for the year — income, transactions,
listing and buyer sales, appointments — plus open deals, pipeline volume,
commission in play, what's closing this month, what's stalled, and who you
haven't spoken to in a month.

**Money tracked properly.** Every deal carries the sale price, your commission
and GST. Cards show price and commission side by side; column headers total both.

**Import your history.** Settings → "Import from a spreadsheet" reads a sales
tracker (quarterly tabs plus an appointment tab), tidies the mess, and shows you
exactly what it will create before saving anything. It copes with dates written
six different ways, spots the same client spelled three different ways and merges
them into one contact with all their deals attached, normalizes source names
while keeping your originals in tags, and refuses to import the same deal twice.

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
js/config.js        >>> the only file you edit: your Client ID, goals, preferences
js/google.js        auth, Sheets, Gmail, Calendar, Drive
js/people.js        Google Contacts (People API)
js/import.js        the spreadsheet importer
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
node test/run.js       # full app, headless browser, mocked Google
node test/parse-test.js # importer parsing logic only, no browser
```

`run.js` exercises the board, search, pipeline switching, drawers, stage moves,
forms, dashboard, settings, the Google Contacts sync and two-way push, and the
whole import flow including the no-duplicates guarantee. `parse-test.js` runs the
importer's date, money, source and name-matching logic against the exact messy
strings from a real tracker. Neither touches the network or a real account.
