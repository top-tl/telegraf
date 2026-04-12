import { Context, Middleware } from "telegraf";

const DEFAULT_POST_INTERVAL = 300_000; // ms; overridden by server

// ---------- Types ----------

interface TopTLClient {
  postStats(
    username: string,
    stats: { users: number; groups: number; channels: number }
  ): Promise<{ interval?: number } | void>;
  hasVoted(username: string, userId: number): Promise<boolean>;
}

interface TopTLOptions {
  /** Override auto-post interval in ms (server value takes precedence). */
  postInterval?: number;
}

interface TopTLContext {
  hasVoted(): Promise<boolean>;
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
    if (ctx.from) {
      this.users.add(ctx.from.id);
    }
    const chat = ctx.chat;
    if (chat) {
      if (chat.type === "group" || chat.type === "supergroup") {
        this.groups.add(chat.id);
      } else if (chat.type === "channel") {
        this.channels.add(chat.id);
      }
    }
  }

  toJSON() {
    return {
      users: this.users.size,
      groups: this.groups.size,
      channels: this.channels.size,
    };
  }
}

// ---------- Middleware ----------

/**
 * Telegraf middleware that tracks users/groups/channels and auto-posts stats
 * to TOP.TL.
 *
 * ```ts
 * import { toptlTelegraf } from "toptl-telegraf";
 * bot.use(toptlTelegraf(client, "mybot"));
 * ```
 */
export function toptlTelegraf(
  client: TopTLClient,
  username: string,
  options: TopTLOptions = {}
): Middleware<Context> {
  const stats = new Stats();
  let interval = options.postInterval ?? DEFAULT_POST_INTERVAL;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startPosting = () => {
    if (timer) return;
    const post = async () => {
      try {
        const resp = await client.postStats(username, stats.toJSON());
        if (resp && typeof resp.interval === "number") {
          // Server asked for a different cadence — restart timer.
          const newInterval = resp.interval * 1000;
          if (newInterval !== interval) {
            interval = newInterval;
            if (timer) clearInterval(timer);
            timer = setInterval(post, interval);
          }
        }
      } catch {
        // Silently retry on next tick.
      }
    };
    timer = setInterval(post, interval);
  };

  startPosting();

  return async (ctx, next) => {
    stats.record(ctx);

    ctx.toptl = {
      async hasVoted(): Promise<boolean> {
        if (!ctx.from) return false;
        try {
          return await client.hasVoted(username, ctx.from.id);
        } catch {
          return false;
        }
      },
    };

    return next();
  };
}

/**
 * Middleware that blocks updates from users who have not voted on TOP.TL.
 *
 * ```ts
 * bot.command("premium", voteRequired(client, "mybot"), (ctx) => { ... });
 * ```
 */
export function voteRequired(
  client: TopTLClient,
  username: string,
  message = "Please vote for this bot on TOP.TL to use this command."
): Middleware<Context> {
  return async (ctx, next) => {
    if (!ctx.from) return;
    try {
      const voted = await client.hasVoted(username, ctx.from.id);
      if (!voted) {
        if (ctx.reply) await ctx.reply(message);
        return;
      }
    } catch {
      // Fail-open on network errors.
    }
    return next();
  };
}
