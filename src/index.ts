import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const bot = new Bot(`${token}`);

// Reply to any message with "Hi there!".
bot.on("message", (ctx) => ctx.reply("Саня лучший снукерист!"));

bot.start();
