import Discord, { Guild, StringResolvable, Role } from 'discord.js'
import { A0EBot, HandlerParams, isTextChannel, BotError } from './bot'
import { LevelGraph } from 'level-ts'
import { CronJob } from 'cron'

const BotToken = process.env.BOT_TOKEN
const ClientId = process.env.CLIENT_ID
const store = new LevelGraph('./database')
const FlagReaction = '🏳'

enum Predicate {
  ActiveCTF = 'ActiveCTF',
  NotifyChannel = 'NotifyChannel',
  CTFStarted = 'CTFStarted',
}

function emojiEquals(a: string, b: string) {
  return a.replace(/[\ufe00-\ufe0f]/g, '') === b.replace(/[\ufe00-\ufe0f]/g, '')
}

function challRole(chall: string) {
  return `chall-${chall}`
}

function timeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return new Promise<T>((res, rej) => {
    setTimeout(() => rej(new Error('Timed out')), ms)
    promise.then(res, rej)
  })
}

async function confirm(message: Discord.Message, confirm: string, timeoutMs = 30 * 1000): Promise<boolean> {
  const Confirm = '✅'
  const Cancel = '❎'
  const msg = await message.channel.send(`${message.author} ${confirm}`)
  try {
    await msg.react(Confirm)
    await msg.react(Cancel)
    const collected = await timeout(
      timeoutMs,
      msg.awaitReactions((r: Discord.MessageReaction, user: Discord.User) =>
        user.id === message.author.id && [Confirm, Cancel].includes(r.emoji.name), {max: 1}
      )
    )
    let r = collected.first()
    if (r?.emoji.name == Confirm) {
      return true
    } else {
      return false
    }
  } catch (e) {
    console.error(e)
    return false
  } finally {
    await msg.delete()
  }
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

async function sendNotify(store: LevelGraph, guild: Guild, text: StringResolvable) {
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

  const active = await getActiveCategory(store, guild)
  for (const [, channel] of guild.channels.cache.filter(i => i.type === 'voice' && i.parent?.id === active.id)) {
    await channel.delete('Deleted by clear')
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

async function newChall({ rest: name, message, store, reply }: HandlerParams) {
  const { author, guild } = message
  if (!guild) throw new BotError('Error: guild not found')

  const category = await getActiveCategory(store, guild)
  const newTextChannel = await guild.channels.create(name, {
    type: 'text',
    parent: category
  })

  try {
    const channels = [...guild.channels.cache.filter(i => i.parent?.id === category.id && i.name === newTextChannel.name).values()]

    if (channels.length > 1) {
      throw new BotError(`The challenge is existed`)
    }

    await guild.roles.fetch()
    const textChannels = [...guild.channels.cache.filter(i => i.type === 'text' && i.parent?.id === category.id).values()].slice().reverse()
    const last = textChannels.find(c => guild.roles.cache.find(i => i.name === challRole(c.name)))

    if (last) {
      await newTextChannel.setPosition(last.position + 1)
    }

    console.log(`New challenge: ${name} by ${author.username}`)

    await guild.channels.create(newTextChannel.name, {
      type: 'voice',
      parent: category
    })
    await guild.roles.create({
      data: {
        name: challRole(newTextChannel.name),
        color: [0, 255, 0],
        hoist: true,
        mentionable: true,
        position: 0
      }
    })
    const msg = await newTextChannel.send('React this message to get the role')
    await msg.react(FlagReaction)
    await msg.pin()
    await reply(`Challenge ${newTextChannel} created`)
    await sendNotify(store, guild, `Challenge ${newTextChannel} created`)
  } catch (e) {
    console.error('Failed to create challenge', e)
    await newTextChannel.delete()
    throw e
  }
}

async function solveChall(params: HandlerParams) {
  const { message, reply } = params
  const { guild, channel, author } = message
  if (!guild) throw new BotError('Error: guild not found')
  if (!isTextChannel(channel)) throw new BotError('Error: !isTextChannel')

  const category = await getActiveCategory(store, guild)
  if (category.id !== channel.parent?.id) {
    reply(`${author} current channel's CTF is not active`)
    return
  }

  await guild.roles.fetch()
  const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
  const voice = guild.channels.cache.find(i => i.parent?.id === category.id && i.name === channel.name && i.type === 'voice')
  if (voice && role) {
    await voice.delete('Challenge solved')
    await role.delete('Challenge solved')
    const newPos = guild.channels.cache.filter(i => i.type === 'text' && i.parent?.id === category.id).size
    await channel.setPosition(newPos - 1)

    await reply(`Challenge ${channel} solved`)
    await sendNotify(store, guild, await getOverview(guild))
    await sendNotify(store, guild, `Challenge ${channel} solved`)
  } else if ((!voice) && (!role)) {
    await reply(`This challenge is already solved`)
  } else {
    await reply(`Error: Wrong state on this challenge`)
  }
}

function min2str(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  const hs = h > 0 ? `${h}h` : ''
  const ms = `0${m}`.slice(-2)
  return `${hs}${ms}m`
}

async function getOverview(guild: Guild) {
  const now = Date.now()
  const active = await getActiveCategory(store, guild)

  let embed = new Discord.MessageEmbed()
    .setColor('FFFF00')
  const result = []
  for (const [, channel] of guild.channels.cache.filter(i => i.type === 'text' && i.parentID === active.id)) {
    const min = Math.floor((now - channel.createdTimestamp) / 60 / 1000)
    const role = guild.roles.cache.find(i => i.name === challRole(channel.name))
    if (role) {
      let users = [...role.members.values()].map(i => i.user.username).join(', ')
      if (users.length === 0) {
        users = 'Nobody'
      }
      result.push(`${channel} (${min2str(min)}) - ${users}`)
    }
  }
  if (result.length === 0) {
    result.push('No challenge is active')
  }
  embed.addField('Overview', result.join('\n'))

  return {
    embed
  }
}

async function overview({ message, reply }: HandlerParams) {
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')

  await reply(await getOverview(guild))
}

async function start({ store, message, reply }: HandlerParams) {
  await checkAdmin(message)
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')
  await updateStore(store, guild.id, Predicate.CTFStarted, '1')
  await reply(`CTF started`)
}

async function stop({ store, message, reply }: HandlerParams) {
  await checkAdmin(message)
  const { guild } = message
  if (!guild) throw new BotError('Error: guild not found')
  await updateStore(store, guild.id, Predicate.CTFStarted, '0')
  await reply(`CTF stopped`)
}

async function deleteMsg({ message, rest, reply, command }: HandlerParams) {
  await checkAdmin(message)
  if (!isTextChannel(message.channel)) throw new BotError('impossible')

  const count = parseInt(rest)
  if (!(0 < count && count <= 100)) {
    await reply(`Usage: ${command} <count>, 0 < count <= 100`)
    return
  }
  console.log(`${message.author.username} try to delete ${count} messages on ${message.channel.name}`)
  const confirmed = await confirm(message, `Are you sure to delete ${count} messages?`)
  if (confirmed) {
    const fetched = await message.channel.messages.fetch({ limit: count + 1 })
    message.channel.bulkDelete(fetched)
    console.log(`${message.author.username} delete done.`)
  } else {
    console.log(`${message.author.username} canceled delete.`)
  }
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
    help: 'Clear all roles start with `chall-` and voice channels. (Admin)'
  })
  bot.addCommand('notify', {
    handler: notify,
    help: 'Set notification channel, CTF events will be sent to the channel. (Admin)'
  })
  bot.addCommand('start', {
    handler: start,
    help: 'Start CTF and start to send notification per hour. (Admin)'
  })
  bot.addCommand('stop', {
    handler: stop,
    help: 'Stop CTF and stop sending notification. (Admin)'
  })
  bot.addCommand('active', {
    handler: active,
    help: 'Make current category as active CTF. (Admin)',
  })
  bot.addCommand('delete', {
    handler: deleteMsg,
    help: 'Bulk delete message above. (Admin)'
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
    if (!emojiEquals(reaction.emoji.name, FlagReaction)) return
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
  });
  // 0 * * * * per hour
  new CronJob('0 * * * *', async () => {
    const tasks = await store.get({ predicate: Predicate.CTFStarted })
    for (const { subject: guildId, object: started } of tasks) {
      const guild = client.guilds.resolve(guildId as string)
      if (!guild) continue
      if (started === '1') {
        await sendNotify(store, guild, await getOverview(guild))
      }
    }
  }).start()
}

main().catch(e => console.error(e))
