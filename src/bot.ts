import Discord, { Message, TextChannel, MessageOptions, StringResolvable, Guild } from 'discord.js'
import { LevelGraph } from 'level-ts'

export class BotError extends Error {
  isBotError = true
  constructor(private content: string, private mention = false) {
    super(content)
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export type ReactionCallback = (reaction: Discord.MessageReaction, user: Discord.User, action: 'Add' | 'Remove') => void
export type HandlerParams = {
  client: Discord.Client
  message: Discord.Message
  reply: (content: StringResolvable) => Promise<Message>
  store: LevelGraph
  rest: string
  command: string
}

export type Handler = (params: HandlerParams) => Promise<void>
type Command = {
  help: string
  handler: Handler
}

export interface BotOptions {
  startTypingTimeout: number
  commandPrefix: string
  store: LevelGraph
}

export class A0EBot {
  private options: BotOptions
  private commands: Record<string, Command> = {}
  private reactionCallback: ReactionCallback[] = []

  constructor (private client: Discord.Client, options?: Partial<BotOptions>) {
    this.options = {
      startTypingTimeout: 500,
      commandPrefix: '.',
      store: new LevelGraph('./database'),
      ...options
    }

    client.on('message', async msg => {
      if (msg.author.bot) {
        // ignore all bot message
        return
      }
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
    client.on('messageReactionAdd', async (reaction, user) => {
      if (reaction.partial) {
        try {
          await reaction.fetch()
        } catch (error) {
          console.log('Something went wrong when fetching the message: ', error)
          return
        }
      }

      for (let cb of this.reactionCallback) {
        cb(reaction, user as Discord.User, 'Add')
      }
    })
    client.on('messageReactionRemove', async (reaction, user) => {
      if (reaction.partial) {
        try {
          await reaction.fetch()
        } catch (error) {
          console.log('Something went wrong when fetching the message: ', error)
          return
        }
      }

      for (let cb of this.reactionCallback) {
        cb(reaction, user as Discord.User, 'Remove')
      }
    })

    this.addCommand('help', {
      help: 'Show help message',
      handler: async ({ reply }) => {
        let result = []
        for (let [command, { help }] of Object.entries(this.commands)) {
          result.push(`${this.options.commandPrefix}${command} - ${help}`)
        }
        await reply(result.join('\n'))
      }
    })
  }
  addCommand(command: string, cmd: Command) {
    this.commands[command] = cmd
  }
  onReaction(callback: ReactionCallback) {
    this.reactionCallback.push(callback)
  }
  private async onMessage (msg: Discord.Message) {
    const { commandPrefix } = this.options
    const reply = (content: StringResolvable) => {
      return msg.channel.send(content)
    }
    if (msg.content.startsWith(commandPrefix)) {
      const content = msg.content.slice(commandPrefix.length)
      const [ command, ...rest ] = content.split(' ')
      const handler = this.commands[command]
      if (!handler) {
        return
      }
      try {
        await handler.handler({
          client: this.client,
          message: msg,
          reply,
          store: this.options.store,
          rest: rest.join(' '),
          command: commandPrefix + command
        })
      } catch (e) {
        console.error(e)
        if (e.isBotError) {
          await reply(e.content)
        } else {
          await reply(`Error: ${e.message}`)
        }
      }
    }
  }
  private async typing<T> (channel: TextChannel, p: Promise<T>) {
    const id = setTimeout(() => {
      channel.startTyping()
    }, this.options.startTypingTimeout)
    try {
      const r = await p
      return r
    } finally {
      channel.stopTyping(true)
      clearTimeout(id)
    }
  }
}

export function isTextChannel (channel: Discord.Channel): channel is Discord.TextChannel {
  return channel.type === 'text'
}
