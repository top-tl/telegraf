import type { Context, Middleware } from "telegraf";
import type { TopTL } from "@toptl/sdk";

const DEFAULT_POST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ---------- Types ----------

interface TopTLOptions {
  /** Autopost interval in ms. Default 30 min. */
  postIntervalMs?: number;
  /** Skip posting when counts haven't changed. Default true. */
  onlyOnChange?: boolean;
}

interface TopTLContext {
  /** Has the current `ctx.from.id` voted for this listing? */
  hasVoted(): Promise<boolean>;
  /** Flush current counts to TOP.TL immediately. */
  postNow(): Promise<void>;
}

declare module "telegraf" {
  interface Context {
    toptl: TopTLContext;
  }
}

// ---------- State ----------

class Stats {
  users = new Set<number>();
  groups = new Set<number>();
  channels = new Set<number>();

  record(ctx: Context): void {
    if (ctx.from) this.users.add(ctx.from.id);
    const chat = ctx.chat;
    if (chat) {
      if (chat.type === "group" || chat.type === "supergroup") {
        this.groups.add(chat.id);
      } else if (chat.type === "channel") {
        this.channels.add(chat.id);
      }
    }
  }

  /** Snapshot in the exact shape @toptl/sdk#postStats expects. */
  snapshot() {
    return {
      memberCount: this.users.size,
      groupCount: this.groups.size,
      channelCount: this.channels.size,
    };
  }
}

// ---------- Middleware ----------

/**
 * Telegraf middleware that tracks unique users/groups/channels and
 * autoposts them to TOP.TL.
 *
 * ```ts
 * import { TopTL } from "@toptl/sdk";
 * import { toptlTelegraf } from "@toptl/telegraf";
 *
 * const client = new TopTL("toptl_xxx");
 * bot.use(toptlTelegraf(client, "mybot"));
 * ```
 */
export function toptlTelegraf(
  client: TopTL,
  username: string,
  options: TopTLOptions = {}
): Middleware<Context> {
  const stats = new Stats();
  const intervalMs = options.postIntervalMs ?? DEFAULT_POST_INTERVAL_MS;
  const onlyOnChange = options.onlyOnChange ?? true;
  let lastPosted: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const flush = async () => {
    const snap = stats.snapshot();
    const key = JSON.stringify(snap);
    if (onlyOnChange && key === lastPosted) return;
    try {
      await client.postStats(username, snap);
      lastPosted = key;
    } catch {
      // Transient errors — next tick retries.
    }
  };

  if (!timer) {
    // Give the bot one interval to collect updates before the first flush.
    timer = setInterval(flush, intervalMs);
  }

  return async (ctx, next) => {
    stats.record(ctx);

    ctx.toptl = {
      async hasVoted(): Promise<boolean> {
        if (!ctx.from) return false;
        try {
          const result = await client.hasVoted(username, ctx.from.id);
          // The real SDK returns { voted, votedAt } — NOT a bare boolean.
          // Earlier 1.0.0 of this plugin treated the object as truthy and
          // let everyone through.
          return !!(result as unknown as { voted?: boolean } | undefined)?.voted;
        } catch {
          return false;
        }
      },
      async postNow(): Promise<void> {
        await flush();
      },
    };

    return next();
  };
}

/**
 * Command-level guard that blocks updates from users who haven't voted.
 *
 * ```ts
 * bot.command("premium", voteRequired(client, "mybot"), (ctx) => { ... });
 * ```
 */
export function voteRequired(
  client: TopTL,
  username: string,
  message = "Please vote for this bot on TOP.TL to use this command."
): Middleware<Context> {
  return async (ctx, next) => {
    if (!ctx.from) return;
    let voted = false;
    try {
      const result = await client.hasVoted(username, ctx.from.id);
      voted = !!(result as unknown as { voted?: boolean } | undefined)?.voted;
    } catch {
      // Fail-open on network errors — don't brick user's bot over a TOP.TL
      // outage. Caller can wrap this for fail-closed behaviour.
      voted = false;
    }
    if (!voted) {
      if (ctx.reply) await ctx.reply(message);
      return;
    }
    return next();
  };
}
