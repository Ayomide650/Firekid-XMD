const pino = require('pino')
const NodeCache = require('node-cache')
const fs = require('fs-extra')
const path = require('path')
const axios = require('axios')
const simpleGit = require('simple-git')
const crypto = require('crypto')
const config = require('./config')

// Import WhatsApp library (assuming baileys)
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

// Import commands from submodule - Updated to handle the actual structure
let commands = {}
try {
    commands = require('./commands')
    console.log('✅ Commands loaded successfully')
    console.log('📋 Available commands:', Object.keys(commands))
} catch (error) {
    console.error('❌ Failed to load commands:', error.message)
    console.log('📁 Checking commands directory...')
    
    // Check if commands directory exists
    if (fs.existsSync('./commands')) {
        console.log('✅ Commands directory exists')
        console.log('📋 Contents:', fs.readdirSync('./commands'))
        
        // Check if index.js exists in commands
        if (fs.existsSync('./commands/index.js')) {
            console.log('✅ Commands index.js exists')
        } else {
            console.log('❌ Commands index.js not found')
        }
    } else {
        console.log('❌ Commands directory does not exist')
    }
    
    // Exit if commands can't be loaded
    process.exit(1)
}

// Initialize logger
const logger = pino({ level: 'info' })

// Initialize cache
const cache = new NodeCache({ stdTTL: 600 }) // 10 minutes default TTL

// Initialize store for message history
const store = makeInMemoryStore({ logger })

class WhatsAppBot {
    constructor() {
        this.prefix = process.env.PREFIX || config.PREFIX || '.'
        this.sessionId = process.env.SESSION_ID || config.SESSION_ID || 'firekid_session'
        this.sessionsPath = path.join(__dirname, 'temp_sessions')
        this.sock = null
        this.qr = null
        
        // Ensure sessions directory exists
        fs.ensureDirSync(this.sessionsPath)
    }

    async initialize() {
        try {
            logger.info('Initializing WhatsApp Bot...')
            
            // Use multi-file auth state
            const { state, saveCreds } = await useMultiFileAuthState(
                path.join(this.sessionsPath, this.sessionId)
            )

            // Create WhatsApp socket
            this.sock = makeWASocket({
                auth: state,
                logger,
                browser: Browsers.macOS('Desktop'),
                generateHighQualityLinkPreview: true,
                markOnlineOnConnect: true,
            })

            // Bind store
            store.bind(this.sock.ev)

            // Handle connection updates
            this.sock.ev.on('connection.update', (update) => {
                this.handleConnectionUpdate(update)
            })

            // Handle credentials update
            this.sock.ev.on('creds.update', saveCreds)

            // Handle incoming messages
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
            // You can generate QR code image here if needed
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
        }
    }

    async handleMessages(m) {
        try {
            const message = m.messages[0]
            if (!message) return

            // Ignore status messages and messages from self
            if (message.key?.remoteJid === 'status@broadcast') return
            if (message.key?.fromMe) return

            const messageType = getContentType(message.message)
            if (!messageType) return

            // Extract message text
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

            // Parse command
            const args = messageText.slice(this.prefix.length).trim().split(' ')
            const commandName = args.shift().toLowerCase()

            // Create message context
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

            // Execute command
            await this.executeCommand(commandName, messageContext)

        } catch (error) {
            logger.error('Error handling message:', error)
        }
    }

    async executeCommand(commandName, context) {
        try {
            // Find command - Updated to work with the actual commands structure
            let commandHandler = null
            
            // Check if command exists directly in commands object
            if (commands[commandName] && typeof commands[commandName] === 'function') {
                commandHandler = commands[commandName]
            }

            if (!commandHandler) {
                await context.reply(`❌ Command "${commandName}" not found. Use ${this.prefix}menu for available commands.`)
                return
            }

            // Execute command - The commands from your repository expect different parameters
            // Most commands expect (sock, m, args) format based on typical Baileys bot structure
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
        
        // Keep process running
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error)
        })

        process.on('unhandledRejection', (error) => {
            logger.error('Unhandled Rejection:', error)
        })
    }
}

// Initialize and start the bot
const bot = new WhatsAppBot()

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down bot...')
    if (bot.sock) {
        bot.sock.end()
    }
    process.exit(0)
})

// Start the bot
bot.start().catch((error) => {
    logger.error('Failed to start bot:', error)
    process.exit(1)
})

// Export for potential external use
module.exports = bot
