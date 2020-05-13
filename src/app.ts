import Discord, { Guild, Role } from 'discord.js'
import { A0EBot, HandlerParams, isTextChannel, BotError } from './bot'
import { LevelGraph } from 'level-ts'

const client = new Discord.Client({ partials: ['MESSAGE', 'CHANNEL', 'REACTION'] })
const BotToken = process.env.BOT_TOKEN
const ClientId = process.env.CLIENT_ID
const store = new LevelGraph('./database')

enum Predicate {
  ActiveCTF = 'ActiveCTF',
}

function challRole(chall: string) {
  return `chall-${chall}`
}

async function getActiveCategory(store: LevelGraph, guild: Guild) {
  const categoryId = await store.find(guild.id, Predicate.ActiveCTF) as string
  if (!categoryId) {
    throw new BotError(`Current active CTF is not set`)
  }
  const category = await client.channels.fetch(categoryId, true) as Discord.CategoryChannel
  return category
}

async function updateStore(store: LevelGraph, subject: string, predicate: string, object: string) {
  const d = {
    subject,
    predicate,
  }
  const result = await store.get(d)
  if (result.length) {
    await store.del(result)
  }
  await store.put({ ...d, object })
}

async function active({ client, message, reply, store }: HandlerParams) {
  const { channel, author, guild } = message
  if (!isTextChannel(channel)) throw new Error('impossible')
  const category = channel.parent
  if (!guild) throw new BotError('Error: guild not found')
  if (!category) throw new BotError('Error: category not found')
  const perm = category.permissionsFor(author)
  if (!perm?.has('MANAGE_CHANNELS')) {
    throw new BotError('Permission denied')
  }
  console.log(`guild: ${guild.name} active ctf: ${category.name} by ${author.username}`)
  await updateStore(store, guild.id, Predicate.ActiveCTF, category.id)
  await reply(`Current active is set to ${category.name}`)
}

async function ctf({ reply, store, message, client }: HandlerParams) {
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')
  const category = await getActiveCategory(store, guild)
  await reply(`Current active CTF is ${category.name}`)
}

async function newChall({ rest: name, message, store, reply }: HandlerParams) {
  const { author, guild } = message
  // if (!ChallengeRE.test(name)) new BotError(`challenge name should follow: ${ChallengeRE.source}`)
  if (!guild) throw new BotError('Error: guild not found')

  const categoryId = await store.find(guild.id, Predicate.ActiveCTF) as string
  if (!categoryId) {
    throw new BotError(`Current active CTF is not set`)
  }
  const category = await client.channels.fetch(categoryId, true) as Discord.CategoryChannel
  const existing = guild.channels.cache.find(i => i.parent?.id === categoryId && i.name === name)
  if (existing) {
    throw new BotError(`The challenge is existed`)
  }
  console.log(`New challenge: ${name} by ${author.username}`)

  const newTextChannel = await guild.channels.create(name, {
    type: 'text',
    parent: category
  })
  await guild.channels.create(name, {
    type: 'voice',
    parent: category
  })
  await guild.roles.create({
    data: {
      name: challRole(name),
      color: [0, 255, 0],
      hoist: true,
      mentionable: true,
      position: 0
    }
  })
  const msg = await newTextChannel.send('React this message to get the role')
  await msg.react('🏳')
  await reply(`Challenge ${newTextChannel} created`)
}

async function main () {
  await client.login(BotToken)
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${ClientId}&permissions=0&scope=bot`)
  const bot = new A0EBot(client, {
    store
  })
  bot.addCommand('active', {
    handler: active,
    help: 'Make current category as active CTF. Only user with manage channel can run this command.',
  })
  bot.addCommand('ctf', {
    handler: ctf,
    help: 'Query current active CTF.',
  })
  bot.addCommand('new', {
    handler: newChall,
    help: 'Create a new Challenge to current active CTF',
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
    const { channel, guild } = reaction.message
    if (user.bot) return
    if (!isTextChannel(channel)) return
    const category = channel.parent
    if (!guild) return
    if (!category) console.error('Error: category not found')
    const active = await getActiveCategory(store, guild)
    if (active.id !== category?.id) {
      return channel.send(`${user} current channel's CTF is not active`)
    }

    await guild.roles.fetch()
    const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
    if (!role) {
      return channel.send(`${user} current channel's role is not found`)
    }
    const member = guild.members.resolve(user.id)
    await member?.roles.add(role)
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
    const { channel, guild } = reaction.message
    if (user.bot) return
    if (!isTextChannel(channel)) return
    if (!guild) return

    await guild.roles.fetch()
    const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
    if (!role) {
      return channel.send(`${user} current channel's role is not found`)
    }
    const member = guild.members.resolve(user.id)
    await member?.roles.remove(role)
  })
}

main().catch(e => console.error(e))
