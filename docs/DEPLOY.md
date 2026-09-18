# Deploying

## As a Claude Artifact (how it runs today)

Publish `src/app.html`, declaring all three capabilities in one call. The
`capabilities` object is a **full-set declaration** — restate everything or the
omitted ones are revoked.

```jsonc
// Artifact tool, action "publish"
{
  "file_path": "/mnt/user-data/outputs/app.html",
  "title": "Thermocracy",
  "favicon": "🥶",
  "capabilities": {
    "db": { "rules": [
      { "path": "votes",        "read": "view", "write": "admin" },
      { "path": "votes/{self}", "write": "interact" }
    ]},
    "user":   {},
    "assets": {}
  }
}
```

To update later without touching capabilities, pass the artifact `url` and
**omit** `capabilities` entirely — the stored set carries forward.

### Seeding

After the first publish, write the starting spots (`seed/zones.json` holds the
same data). Use a `write_db` `batch`:

```jsonc
{
  "url": "<artifact url>",
  "db_op": "batch",
  "writes": [
    { "op": "set", "collection": "zones", "doc_id": "level-7-north-window-seats",
      "data": { "floor": "Level 7", "name": "North window seats", "x": 50, "y": 9 } }
    // … see seed/zones.json for the rest
  ]
}
```

Don't hardcode seed data inside the HTML. The app is built to start empty with a
usable empty state, and hardcoded seeds would fight the live store.

### Sharing

Declaring `db` makes the artifact organisation-internal — it cannot be shared by
public link. That's correct here. Share it with "Can interact" so colleagues can
vote; "Can edit" additionally allows uploading floor plans and publishing.

---

## Anywhere else

`src/app.html` opens directly in a browser with no server. Off-platform, all
three `claude.use()` calls resolve `null` and the app runs **local-only**: votes
live in the tab, a banner explains why, the built-in sketch plan is used.

That's genuinely useful for a demo or a single-screen kiosk, but it's not
multi-user. For that, replace the store. The entire backend surface is three
collections and about sixty lines at the bottom of the script:

| Replace | With |
|---|---|
| `db.collection("zones").onSnapshot` | any live query or poll |
| `db.collection("votes").onSnapshot` | same |
| `db.collection("plans").onSnapshot` | same |
| `db.doc("votes/"+uid).set({v:body})` | authenticated write, server-enforced to the caller's own id |
| `assetsCap.upload(file)` | any object store returning a URL |

The one rule the server must enforce is that a caller can only write their own
vote document. That's what the `votes/{self}` rule does today, and it's the only
thing preventing ballot stuffing.

---

## The explainer

`src/explainer.html` has no capabilities and no data. Publish it, host it, or
open it from disk — all equivalent. See `docs/VIDEO-GUIDE.md` for recording.
