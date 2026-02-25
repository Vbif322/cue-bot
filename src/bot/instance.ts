import { Bot } from "grammy";
import type { BotContext } from "./types.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN is not set");
}

export const bot = new Bot<BotContext>(token);
