# B-r0 Campaign Copilot

B-r0 is a campaign-aware Discord bot for tabletop communities. It combines configurable personas, scoped conversation memory, Roll20 lore retrieval, scheduling, dice, image generation and analysis, web-grounded answers, and opt-in community check-ins.

## Safety and privacy defaults

- Personal memory is off until each user enables it with `/memory enable`.
- `/forgetme confirm:true` deletes that user's history, facts, summary, and chat configuration for the current server.
- Destructive and server-configuration commands require Discord's **Manage Server** permission.
- Events, history, Roll20 records, check-ins, and webhook subscriptions are server-scoped.
- Generated content cannot trigger `@everyone` or `@here`; scheduled reminders do not mass-mention.
- Protected HTTP routes require `Authorization: Bearer <API_KEY>`.

## Requirements

- Node.js 22–26 (Node 24 is used in CI and Docker)
- MongoDB
- Discord application tokens
- OpenAI API key
- Optional Azure Vision, classifier service, and Sentry credentials

## Local setup

```powershell
Copy-Item .env.example .env
npm ci
npm run check
npm test
npm run smoke:openai
npm run start:test
```

If the local network blocks Node's DNS SRV requests, the app automatically retries MongoDB Atlas discovery through DNS-over-HTTPS. Set `MONGODB_DOH_FALLBACK=false` to disable that behavior.

Non-production runs automatically prefer `DISCORD_TESTING_TOKEN`. Production uses `DISCORD_TOKEN_PROD`, falling back to `DISCORD_TOKEN`.

## Main commands

- `/personas list|select`
- `/model list|select` — Sol (highest quality), Terra (balanced), or Luna (fastest/lowest cost)
- `/memory status|enable|disable|list|forget|clear`
- `/roll dice:2d6+1d4-2`
- `/image generate`
- `/schedule manage` — private visual picker with Edit, Pause/Resume, and confirmed Delete controls
- `/schedule create|quick|edit|pause|resume|delete|list|help` — event-name fields autocomplete as you type
- Scheduling supports once, daily, weekly, every-two-weeks, and monthly recurrence, advance offsets such as `1d,2h,15m`, and clock-time reminders such as `daily at 5 PM`.
- Managers can also mention or reply to B-r0 naturally: “schedule Session 37 Thursday at 8:30 PM CDT and remind us daily at 5 PM.” B-r0 previews the interpreted event for confirmation before saving it.
- `/checkin enable|disable|status`
- `/responsemode enable|disable|configure|status` — mention-only, smart, or always modes with cooldown and confidence controls
- `/webhook list|subscribe|unsubscribe`
- `/mentalhealthcheckin enable|disable|snooze|resume|test|status` — private opt-in DMs with cadence, quiet hours, timezone, and tone
- `/sirmode adduser|removeuser|start|stop|status` — bounded, persistent voice attendance reminders
- `/forgetme confirm:true`

Administrative commands are permission-gated both in Discord's command metadata and again at runtime.

## HTTP API

- `GET /api/status`
- `GET /api/config`
- `GET /api/uptime`
- `GET /api/chathistory?guildId=...`
- `DELETE /api/clearChatHistory?guildId=...`
- `GET /api/currentJournal?guildId=...`
- `GET /api/currentHandouts?guildId=...`
- `POST /api/uploadRoll20Data/journal?guildId=...`
- `POST /api/uploadRoll20Data/handouts?guildId=...`
- `POST /api/webhook`

Interactive documentation is at `/api-docs`; the OpenAPI document is at `/openapi.json`. List endpoints support bounded `limit` and `skip` parameters.

Roll20 uploads are JSON arrays containing `Name` and optional `Bio` fields. Existing legacy Roll20 data should be uploaded once per Discord guild so it receives guild and record-type ownership.

## Verification

```powershell
npm run check
npm test
npm audit --omit=dev
docker build -t b-r0 .
```

CI runs syntax checks, tests, a production dependency audit, and the Docker build before publishing the image on pushes to `main`.

## Architecture

- `src/discord`: Discord gateway and command handling
- `src/openai`: response, web search, event extraction, and structured-output calls
- `src/services/memory`: opt-in facts and summaries
- `src/api`: authenticated Hono API and documentation
- `src/models`: server- and user-scoped MongoDB documents
- `src/utils`: scheduling, privacy, security, dice, and check-in helpers

The default conversational model is GPT-5.6 Terra. GPT-5.6 Luna handles narrow, latency-sensitive background work such as schedule extraction, response checks, facts, and summaries. GPT-5.6 Sol remains selectable for the hardest user-facing reasoning. Webhook reports and image analysis use Terra; GPT Image 2 handles image generation.

All OpenAI text workloads use the Responses API. Scheduling, response decisions, and fact extraction use strict Structured Outputs backed by Zod schemas instead of best-effort JSON mode. Model and reasoning-effort routes can be overridden independently in `.env`; see `.env.example` for the complete matrix.
