import discord
import aiohttp
import os
import time

intents = discord.Intents.default()
intents.message_content = True

client = discord.Client(intents=intents)

CHANNEL_ID      = int(os.getenv("DISCORD_CHANNEL_ID"))
N8N_WEBHOOK     = os.getenv("N8N_WEBHOOK")
TOKEN           = os.getenv("DISCORD_TOKEN")
COOLDOWN_SECONDS = int(os.getenv("BOT_COOLDOWN_SECONDS", "5"))

# Per-author cooldown: {author_id: last_sent_monotonic_time}
_cooldowns: dict[int, float] = {}

@client.event
async def on_ready():
    print(f"nola Discord bridge ready as {client.user}")

@client.event
async def on_message(message):
    if message.author.bot or message.channel.id != CHANNEL_ID:
        return

    now = time.monotonic()
    if now - _cooldowns.get(message.author.id, 0) < COOLDOWN_SECONDS:
        await message.add_reaction("⏳")
        return
    _cooldowns[message.author.id] = now

    async with message.channel.typing():
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60)) as session:
                payload = {
                    "message": message.content,
                    "source": "discord",
                    "author": message.author.display_name
                }
                async with session.post(N8N_WEBHOOK, json=payload) as resp:
                    data = await resp.json()
                    response_text = data.get("output", data.get("text", str(data)))
        except Exception as e:
            response_text = f"NOLA encountered an error: {str(e)}"

    await message.reply(response_text)

client.run(TOKEN)
