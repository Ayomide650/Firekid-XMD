require('dotenv').config()

const pino = require('pino')
const NodeCache = require('node-cache')
const fs = require('fs-extra')
const path = require('path')
const axios = require('axios')
const simpleGit = require('simple-git')
const crypto = require('crypto')
const config = require('./config')

global.crypto = crypto

const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    makeInMemoryStore,
    Browsers,
    jidNormalizedUser,
    proto,
    getContentType 
} = require('@whiskeysockets/baileys')

let commands = {}
try {
    commands = require('./commands')
    console.log('✅ Commands loaded successfully')
    console.log('📋 Available commands:', Object.keys(commands))
} catch (error) {
    console.error('❌ Failed to load commands:', error.message)
    console.log('📁 Checking commands directory...')
    
    if (fs.existsSync('./commands')) {
        console.log('✅ Commands directory exists')
        console.log('📋 Contents:', fs.readdirSync('./commands'))
        
        if (fs.existsSync('./commands/index.js')) {
            console.log('✅ Commands index.js exists')
        } else {
            console.log('❌ Commands index.js not found')
        }
    } else {
        console.log('❌ Commands directory does not exist')
    }
    
    process.exit(1)
}

const logger = pino({ level: 'info' })

const cache = new NodeCache({ stdTTL: 600 })

const store = makeInMemoryStore({ logger })

class WhatsAppBot {
    constructor() {
        this.prefix = process.env.PREFIX || config.PREFIX || '.'
        this.sessionId = process.env.SESSION_ID || config.SESSION_ID || '687D2F34AA270098'
        this.sessionsPath = path.join(__dirname, 'temp_sessions')
        this.sock = null
        this.qr = null
        
        fs.ensureDirSync(this.sessionsPath)
        
        this.copySessionFromRepo()
    }

    async copySessionFromRepo() {
        try {
            // Check multiple possible locations for sessions
            const possibleSessionPaths = [
                path.join(__dirname, 'sessions', this.sessionId),
                path.join(__dirname, 'commands', 'sessions', this.sessionId),
                path.join(__dirname, 'temp_sessions', this.sessionId)
            ]
            
            const tempSessionPath = path.join(this.sessionsPath, this.sessionId)
            let sessionFound = false
            
            for (const sessionPath of possibleSessionPaths) {
                console.log(`Checking for session at: ${sessionPath}`)
                
                if (fs.existsSync(sessionPath)) {
                    console.log(`✅ Found session at: ${sessionPath}`)
                    fs.ensureDirSync(tempSessionPath)
                    fs.copySync(sessionPath, tempSessionPath)
                    console.log(`✅ Copied session ${this.sessionId} to temp_sessions`)
                    
                    // Verify the files were copied
                    if (fs.existsSync(path.join(tempSessionPath, 'creds.json'))) {
                        console.log(`✅ creds.json found in session`)
                        sessionFound = true
                        break
                    } else {
                        console.log(`❌ creds.json missing in copied session`)
                    }
                }
            }
            
            if (!sessionFound) {
                console.log(`⚠️ Session ${this.sessionId} not found in any location`)
                console.log(`Available sessions:`)
                try {
                    // Check commands/sessions directory
                    const commandsSessionsDir = path.join(__dirname, 'commands', 'sessions')
                    if (fs.existsSync(commandsSessionsDir)) {
                        console.log(`In commands/sessions:`)
                        const availableSessions = fs.readdirSync(commandsSessionsDir)
                        console.log(availableSessions)
                    }
                    
                    // Check root sessions directory
                    const sessionsDir = path.join(__dirname, 'sessions')
                    if (fs.existsSync(sessionsDir)) {
                        console.log(`In root sessions:`)
                        const availableSessions = fs.readdirSync(sessionsDir)
                        console.log(availableSessions)
                    }
                } catch (error) {
                    console.log(`Error listing sessions: ${error.message}`)
                }
            }
        } catch (error) {
            console.error('Error copying session from repo:', error.message)
        }
    }

    async syncSessionToRepo() {
        try {
            const sessionPath = path.join(this.sessionsPath, this.sessionId)
            if (fs.existsSync(sessionPath)) {
                
                const targetSessionPath = path.join(__dirname, 'sessions', this.sessionId)
                fs.ensureDirSync(path.dirname(targetSessionPath))
                
                fs.copySync(sessionPath, targetSessionPath)
                
                console.log(`Session copied to: sessions/${this.sessionId}`)
                
                try {
                    const git = simpleGit(__dirname)
                    
                    await git.addConfig('user.email', 'bot@firekid.com')
                    await git.addConfig('user.name', 'Firekid Bot')
                    
                    await git.add('sessions/')
                    await git.commit(`Add session: ${this.sessionId}`)
                    await git.push('origin', 'main')
                    
                    console.log('Session pushed to repository successfully')
                } catch (gitError) {
                    console.log('Git operation failed:', gitError.message)
                }
            }
        } catch (error) {
            console.error('Error syncing session:', error.message)
        }
    }

    async initialize() {
        try {
            logger.info('Initializing WhatsApp Bot...')
            
            const { state, saveCreds } = await useMultiFileAuthState(
                path.join(this.sessionsPath, this.sessionId)
            )

            this.sock = makeWASocket({
                auth: state,
                logger,
                browser: Browsers.macOS('Desktop'),
                generateHighQualityLinkPreview: true,
                markOnlineOnConnect: true,
            })

            store.bind(this.sock.ev)

            this.sock.ev.on('connection.update', (update) => {
                this.handleConnectionUpdate(update)
            })

            this.sock.ev.on('creds.update', saveCreds)

            this.sock.ev.on('messages.upsert', async (m) => {
                await this.handleMessages(m)
            })

            logger.info('Bot initialized successfully!')
            
        } catch (error) {
            logger.error('Failed to initialize bot:', error)
            process.exit(1)
        }
    }

    handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            this.qr = qr
            logger.info('QR Code generated. Scan with WhatsApp to connect.')
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
            
            if (shouldReconnect) {
                logger.info('Connection closed, reconnecting...')
                setTimeout(() => this.initialize(), 3000)
            } else {
                logger.error('Connection closed. Please restart and scan QR code.')
            }
        } else if (connection === 'open') {
            logger.info('WhatsApp connection opened successfully!')
            this.qr = null
            
            setTimeout(() => {
                this.syncSessionToRepo()
            }, 5000)
        }
    }

    async handleMessages(m) {
        try {
            const message = m.messages[0]
            if (!message) return

            if (message.key?.remoteJid === 'status@broadcast') return
            if (message.key?.fromMe) return

            const messageType = getContentType(message.message)
            if (!messageType) return

            let messageText = ''
            if (messageType === 'conversation') {
                messageText = message.message.conversation
            } else if (messageType === 'extendedTextMessage') {
                messageText = message.message.extendedTextMessage.text
            } else if (messageType === 'imageMessage' && message.message.imageMessage.caption) {
                messageText = message.message.imageMessage.caption
            } else if (messageType === 'videoMessage' && message.message.videoMessage.caption) {
                messageText = message.message.videoMessage.caption
            }

            if (!messageText || !messageText.startsWith(this.prefix)) return

            const args = messageText.slice(this.prefix.length).trim().split(' ')
            const commandName = args.shift().toLowerCase()

            const messageContext = {
                sock: this.sock,
                message,
                args,
                messageText,
                messageType,
                sender: jidNormalizedUser(message.key.remoteJid),
                isGroup: message.key.remoteJid.endsWith('@g.us'),
                reply: async (text) => {
                    await this.sock.sendMessage(message.key.remoteJid, { text })
                }
            }

            await this.executeCommand(commandName, messageContext)

        } catch (error) {
            logger.error('Error handling message:', error)
        }
    }

    async executeCommand(commandName, context) {
        try {
            let commandHandler = null
            
            if (commands[commandName]) {
                const command = commands[commandName]
                
                if (typeof command === 'function') {
                    commandHandler = command
                } else if (command.handler && typeof command.handler === 'function') {
                    commandHandler = command.handler
                } else if (command.execute && typeof command.execute === 'function') {
                    commandHandler = command.execute
                } else if (typeof command === 'object' && command.default && typeof command.default === 'function') {
                    commandHandler = command.default
                }
            }

            if (!commandHandler) {
                await context.reply(`❌ Command "${commandName}" not found. Use ${this.prefix}menu for available commands.`)
                return
            }

            await commandHandler(context.sock, context.message, context.args)
            
            logger.info(`Command executed: ${commandName} by ${context.sender}`)

        } catch (error) {
            logger.error(`Error executing command ${commandName}:`, error)
            await context.reply('❌ An error occurred while executing the command.')
        }
    }

    async start() {
        logger.info('Starting WhatsApp Bot...')
        await this.initialize()
        
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error)
        })

        process.on('unhandledRejection', (error) => {
            logger.error('Unhandled Rejection:', error)
        })
    }
}

const bot = new WhatsAppBot()

process.on('SIGINT', () => {
    logger.info('Shutting down bot...')
    if (bot.sock) {
        bot.sock.end()
    }
    process.exit(0)
})

bot.start().catch((error) => {
    logger.error('Failed to start bot:', error)
    process.exit(1)
})

module.exports = bot
