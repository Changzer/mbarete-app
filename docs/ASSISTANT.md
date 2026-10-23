# Chat assistants (OpenClaw and the like)

A chat assistant running on your computer — OpenClaw, or anything that can
call a web address — can work in Mbarete for you: "order 3456, the deposit
is paid, move it to production", "who is waiting on the Angel Packing
order?", "add the supplier on this business card". It does that with its
**own key**, not your login.

What that buys you:

- **Its own account.** Everything it changes shows under its name in the
  card history and the Activity page, so you always know what was it.
- **Only what you allow.** Reading orders, the follow-up board, contacts and
  products is always on. Three ticks decide the rest:
  - *Update the follow-up board* — move cards, next step and who, problems,
    updates, checklist.
  - *Add and edit contacts* — suppliers and clients.
  - *See prices and amounts* — costs, selling prices, order totals. Left
    off, they never leave Mbarete.
- **Never, whatever is ticked:** deleting anything, settings, the team, the
  finance report, the platform panel, bank details, signing in to the
  website, being given a task.
- **Off in one click.** Switching it off or making a new key stops the old
  key on its very next request.

## Setting it up

**1. In Mbarete** — Team page (Users) → **Assistants** → **Add an
assistant**. Name it (e.g. "OpenClaw"), tick what it may do, press **Create
and show the key**. Copy the key (`mbk_…`) now: it is shown only once. Lost
it? **New key** makes another; the old one stops working.

**2. The skill file** — in the same box, download **SKILL.md** (or open
`https://<your Mbarete address>/api/assistant/skill`). It teaches the
assistant the API and its rules, and already holds your app's address. On
the computer where OpenClaw runs, put it at:

```
~/.openclaw/skills/mbarete/SKILL.md
```

(If your OpenClaw works from a workspace, its `skills/mbarete/` folder
works too.)

**3. The key** — give it to OpenClaw as `MBARETE_API_KEY`, in OpenClaw's
config file `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "mbarete": { "enabled": true, "apiKey": "mbk_…your key…" }
    }
  }
}
```

or as an environment variable `MBARETE_API_KEY` where OpenClaw starts.
**Do not paste the key into the chat**: whatever you type there goes to the
AI company behind the assistant. In the config, the assistant uses it
without ever reading it.

**4. Try it** — start a new chat and ask *"What can you do in Mbarete?"*.
It should name your company and what you allowed. Then something real:
*"Check order 3456 and tell me where each supplier is."*

## Using it safely

- **It reads back before it changes.** The skill tells the assistant to say
  exactly what it will change — order, supplier, from → to — and wait for
  your yes. If it ever doesn't, say so in the chat, and check the card.
- **Supplier text is not your voice.** Notes, product descriptions and
  supplier names were written by other people. The skill tells the
  assistant never to obey instructions found in them; the permissions above
  are what really stop it.
- **Everything it reads goes to its AI company** (Claude, GPT, Kimi…), even
  when OpenClaw itself runs on your computer. That is why prices stay off
  unless you tick them.
- **Something looks wrong?** Team page → **Switch off**. Its history stays;
  the card feed and Activity show what it did.

## For developers: the API

`https://<origin>/api/assistant/v1/…`, header `Authorization: Bearer mbk_…`,
JSON in and out. `GET /api/assistant/v1` lists what this key may call.

| Method | Path | Needs |
| --- | --- | --- |
| GET | the index (no path) · `team` · `orders?q=&status=` · `orders/{id or number}` · `followup?q=&stage=&order=&ownerId=` · `followup/{id}` · `contacts?q=&type=` · `contacts/{id}` · `products?q=&supplierId=` · `products/{id}` | the key |
| POST | `followup/{id}/stage` · `followup/{id}/next-step` · `followup/{id}/problem` · `followup/{id}/updates` · `followup/{id}/checklist` | follow-up |
| PATCH | `checklist/{id}` | follow-up |
| POST · PATCH | `contacts` · `contacts/{id}` | contacts |

Add `lang=zh` to reads for Chinese names. Money fields appear only with the
prices permission. Card changes carry the card's `version`; a stale one gets
`409`, exactly like a stale save on the board.

How it holds together (src/lib/assistant-*.ts):

- The key reads `mbk_<account id>_<secret>`. Only the secret's SHA-256 is
  stored (`assistant_keys`, under row-level security); the account id lets
  the server find the company before any tenant data is read.
- An assistant is a `users` row with `kind = 'assistant'`: always a
  collaborator, never platform admin (a database check), no password, no
  seat, never in "who" lists, refused by sign-in and password reset.
- Inside an API request the key's account becomes the request's identity
  (`assistant-context.ts`), so every write runs through the **same server
  action** a person's click does — validation, stale-save refusal, history
  — and `requireUser()` answers with the assistant. No other route accepts a
  key.
- Braked: 30 wrong keys per address per 15 minutes; per assistant, 240
  requests and 30 changes a minute. JSON bodies only, 20 kB at most.

Tested end to end by `npm run test:assistant` (src/ui-tests/assistant.spec.mjs).
