import Discord, { Guild, Role } from 'discord.js'
import { A0EBot, HandlerParams, isTextChannel, BotError } from './bot'
import { LevelGraph } from 'level-ts'

const BotToken = process.env.BOT_TOKEN
const ClientId = process.env.CLIENT_ID
const store = new LevelGraph('./database')

enum Predicate {
  ActiveCTF = 'ActiveCTF',
  NotifyChannel = 'NotifyChannel',
}

function challRole(chall: string) {
  return `chall-${chall}`
}

async function getActiveCategory(store: LevelGraph, guild: Guild) {
  const categoryId = await store.find(guild.id, Predicate.ActiveCTF) as string
  if (!categoryId) {
    throw new BotError(`Current active CTF is not set`)
  }
  const category = guild.channels.resolve(categoryId) as Discord.CategoryChannel
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

async function checkAdmin(message: Discord.Message) {
  const { channel, author, guild } = message
  if (!isTextChannel(channel)) throw new Error('impossible')
  const category = channel.parent
  if (!guild) throw new BotError('Error: guild not found')
  if (!category) throw new BotError('Error: category not found')
  const perm = category.permissionsFor(author)
  if (!perm?.has('MANAGE_CHANNELS')) {
    throw new BotError('Permission denied')
  }
}

async function sendNotify(store: LevelGraph, guild: Guild, text: string) {
  try {
    const id = await store.find(guild.id, Predicate.NotifyChannel) as string | null
    if (!id) return
    const channel = guild.channels.resolve(id)
    if (!channel) return
    if (!isTextChannel(channel)) return
    await channel.send(text)
  } catch (e) {
    console.error('Failed to send notify', e)
  }
}

async function clear({ message, reply }: HandlerParams) {
  await checkAdmin(message)
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')
  await guild.roles.fetch()
  for (const [, role] of guild.roles.cache.filter(i => i.name.startsWith(challRole('')))) {
    await role.delete('Deleted by clear')
  }
  await reply(`Clear done`)
}

async function notify({ rest: msg, message, store, reply }: HandlerParams) {
  await checkAdmin(message)
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')

  const target = msg.replace(/\D/g, '')
  guild.channels.resolve(target)

  await updateStore(store, guild.id, Predicate.NotifyChannel, target)
  await reply(`Notification will be sent to <#${target}>`)
}

async function active({ message, reply, store }: HandlerParams) {
  await checkAdmin(message)
  const { channel, author, guild } = message
  if (!isTextChannel(channel)) throw new Error('impossible')
  const category = channel.parent
  if (!guild) throw new BotError('Error: guild not found')
  if (!category) throw new BotError('Error: category not found')
  console.log(`guild: ${guild.name} active ctf: ${category.name} by ${author.username}`)
  await updateStore(store, guild.id, Predicate.ActiveCTF, category.id)
  await reply(`Current active CTF is set to ${category.name}`)
}

async function ctf({ reply, store, message, client }: HandlerParams) {
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')
  const category = await getActiveCategory(store, guild)
  await reply(`Current active CTF is ${category.name}`)
}

async function newChall({ rest: name, message, store, reply, client }: HandlerParams) {
  const { author, guild } = message
  if (!guild) throw new BotError('Error: guild not found')
  const CheckRE = / /
  if (CheckRE.test(name)) throw new BotError(`Error: challenge name can't contain /${CheckRE.source}/`)

  const category = await getActiveCategory(store, guild)
  const existing = guild.channels.cache.find(i => i.parent?.id === category.id && i.name === name)
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
  await msg.pin()
  await reply(`Challenge ${newTextChannel} created`)
  await sendNotify(store, guild, `Challenge ${newTextChannel} created`)
}

async function solveChall({ message, reply }: HandlerParams) {
  const { guild, channel, author } = message
  if (!guild) throw new BotError('Error: guild not found')
  if (!isTextChannel(channel)) throw new BotError('Error: !isTextChannel')

  const category = await getActiveCategory(store, guild)
  if (category.id !== channel.parent?.id) {
    reply(`${author} current channel's CTF is not active`)
    return
  }

  await channel.setPosition(1000)
  const voice = guild.channels.cache.find(i => i.parent?.id === category.id && i.name === channel.name && i.type === 'voice')
  if (voice) {
    await voice.delete('Challenge solved')
  }

  await guild.roles.fetch()
  const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
  if (role) {
    await role.delete('Challenge solved')
  }

  await reply(`Challenge ${channel} solved`)
  await sendNotify(store, guild, `Challenge ${channel} solved`)
}

async function overview({ message, reply }: HandlerParams) {
  let result = []

  const now = Date.now()
  const { guild, channel, author } = message
  if (!guild) throw new BotError('Error: guild not found')
  const active = await getActiveCategory(store, guild)

  for (const [, channel] of guild.channels.cache.filter(i => i.type === 'text' && i.parentID === active.id)) {
    const min = Math.floor((now - channel.createdTimestamp) / 60 / 1000)
    const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
    if (role) {
      let users = [...role.members.values()].map(i => i.user.username).join(', ')
      if (users.length === 0) {
        users = 'Nobody'
      }
      result.push(`${channel.name} (${min}min) - ${users}`)
    }
  }

  reply(result)
}

async function main () {
  const client = new Discord.Client({ partials: ['MESSAGE', 'CHANNEL', 'REACTION'] })
  await client.login(BotToken)
  console.log(`https://discordapp.com/oauth2/authorize?client_id=${ClientId}&permissions=0&scope=bot`)
  const bot = new A0EBot(client, {
    store
  })
  bot.addCommand('clear', {
    handler: clear,
    help: 'Clear all roles start with `chall-` (Admin)'
  })
  bot.addCommand('notify', {
    handler: notify,
    help: 'Set notification channel, CTF events will be sent to the channel. (Admin)'
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
    help: 'Create a new challenge to current active CTF',
  })
  bot.addCommand('solve', {
    handler: solveChall,
    help: 'Solve current challenge, will remove the voice channel and role with the same name.',
  })
  bot.addCommand('overview', {
    handler: overview,
    help: 'List all challenges and users on each challenge.'
  })
  bot.onReaction(async (reaction, user, action) => {
    if (!reaction.me) return
    const { channel, guild } = reaction.message
    if (user.bot) return
    if (!isTextChannel(channel)) return
    const category = channel.parent
    if (!guild) return
    if (!category) console.error('Error: category not found')
    const active = await getActiveCategory(store, guild)
    if (action === 'Add' && active.id !== category?.id) {
      return channel.send(`${user} current channel's CTF is not active`)
    }

    await guild.roles.fetch()
    const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
    if (!role) {
      return channel.send(`${user} current channel's role is not found`)
    }
    const member = guild.members.resolve(user.id)
    if (action === 'Add') {
      await member?.roles.add(role)
    } else if (action === 'Remove') {
      await member?.roles.remove(role)
    }
  })
}

main().catch(e => console.error(e))
