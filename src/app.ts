import Discord, { Message, TextChannel, MessageOptions } from 'discord.js'

const client = new Discord.Client()
const BotToken = process.env.BOT_TOKEN
const CommandPrefix = process.env.CMD_PREFIX || ','
const ClientId = process.env.CLIENT_ID
const StartTypingTimeout = 200

class A0EBot {
  constructor (private client: Discord.Client) {
    client.on('message', async msg => {
      try {
        if (isTextChannel(msg.channel)) {
          await this.typing(msg.channel, this.onMessage(msg))
        } else {
          await this.onMessage(msg)
        }
      } catch (e) {
        msg.reply(`Error: ${e.message}`)
      }
    })
  }
  async onMessage (msg: Discord.Message) {

  }
  async typing<T> (channel: TextChannel, p: Promise<T>) {
    let id = setTimeout(() => {
      channel.startTyping()
    }, StartTypingTimeout)
    try {
      const r = await p
      return r
    } finally {
      channel.stopTyping(true)
      clearTimeout(id)
    }
  }
}

function isTextChannel (channel: Discord.Channel): channel is Discord.TextChannel {
  return channel.type === 'text'
}

async function main () {
  await client.login(BotToken)
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${ClientId}&permissions=0&scope=bot`)
  new A0EBot(client)
}

main().catch(e => console.error(e))
