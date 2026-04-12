# toptl-telegraf

Telegraf plugin for [TOP.TL](https://top.tl) — auto-post bot stats and check votes.

## Installation

```bash
npm install toptl-telegraf
```

## Quick start

```ts
import { Telegraf } from "telegraf";
import { TopTLClient } from "toptl";
import { toptlTelegraf, voteRequired } from "toptl-telegraf";

const client = new TopTLClient("your-api-token");
const bot = new Telegraf("BOT_TOKEN");

// Track stats & add ctx.toptl
bot.use(toptlTelegraf(client, "mybot"));

bot.start((ctx) => ctx.reply("Hello!"));
bot.launch();
```

## Vote-gating

Block commands for users who haven't voted:

```ts
bot.command(
  "premium",
  voteRequired(client, "mybot", "Vote first! https://top.tl/mybot"),
  (ctx) => {
    ctx.reply("Thanks for voting!");
  }
);
```

## Manual vote check

```ts
bot.command("check", async (ctx) => {
  const voted = await ctx.toptl.hasVoted();
  ctx.reply(voted ? "You voted!" : "Please vote.");
});
```

## How it works

- **Tracking** — The middleware records unique user, group, and channel IDs from every update.
- **Auto-posting** — A `setInterval` timer posts aggregated stats to TOP.TL at a server-controlled interval.
- **Vote checks** — `ctx.toptl.hasVoted()` and the `voteRequired` middleware query the TOP.TL API.

## License

MIT
