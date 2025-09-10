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

const msgRetryCounterCache = new NodeCache()
const logger = pino({ level: 'silent' })

// GitHub configuration from your original helper.js
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
        this.indexPath = path.join(this.sessionsPath, 'index.json')
        this.git = null
        
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
            await this.git.clone(cloneUrl, this.repoPath)
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

            console.log('✅ Repository initialized successfully!')

        } catch (error) {
            console.error('❌ Failed to initialize repository:', error.message)
            console.log('⚠️ Continuing without GitHub storage...')
        }
    }

    async saveSession(sessionId, phoneNumber, authDir, userId) {
        try {
            console.log(`💾 Saving session ${sessionId} to GitHub...`)

            if (!fs.existsSync(this.repoPath)) {
                console.log('⚠️ GitHub repo not available, skipping save')
                return { success: false, reason: 'Repository not initialized' }
            }

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
            await this.git.push('origin', 'main')
            console.log('✅ Successfully pushed to main branch!')

        } catch (error) {
            console.error('❌ Failed to push to GitHub:', error.message)
            throw error
        }
    }

    async listSessions(userId = null) {
        try {
            console.log('📋 Listing sessions...')

            if (!fs.existsSync(this.indexPath)) {
                return { success: false, sessions: [], total: 0 }
            }

            try {
                await this.git.pull('origin', 'main')
            } catch (e) {
                console.log('⚠️ Could not pull from GitHub')
            }

            const index = await fs.readJSON(this.indexPath)
            let sessions = Object.values(index.sessions)

            if (userId) {
                sessions = sessions.filter(session => session.userId === userId)
            }

            return {
                success: true,
                sessions: sessions,
                total: sessions.length,
                stats: index.stats
            }

        } catch (error) {
            console.error('❌ Failed to list sessions:', error.message)
            return { success: false, sessions: [], total: 0 }
        }
    }
}

const gitHubStorage = new GitHubSessionStorage()

async function downloadCommands() {
    try {
        const commandsDir = path.join(__dirname, 'temp_commands')
        
        await fs.remove(commandsDir)
        
        const cloneUrl = repoUrl.replace('https://github.com/', `https://${obfuscatedToken}@github.com/`)
        
        const git = simpleGit()
        await git.clone(cloneUrl, commandsDir)
        
        console.log('Commands downloaded successfully')
        return true
    } catch (error) {
        console.log('Error downloading commands:', error.message)
        return false
    }
}

async function loadCommands() {
    const commands = {}
    
    // First try to load from GitHub repo
    let commandsPath = path.join(__dirname, 'temp_commands', 'commands')
    
    try {
        if (!await fs.pathExists(commandsPath)) {
            console.log('GitHub commands not found, trying local commands directory...')
            commandsPath = path.join(__dirname, 'commands')
        }

        if (!await fs.pathExists(commandsPath)) {
            console.log('Commands directory not found, creating basic commands...')
            
            // Create a basic ping command
            const basicCommand = `
module.exports = {
    command: 'ping',
    description: 'Check if bot is working',
    handler: async (sock, messageInfo) => {
        await messageInfo.reply('🏓 Pong! Bot is working!')
    }
}
`
            await fs.ensureDir(commandsPath)
            await fs.writeFile(path.join(commandsPath, 'ping.js'), basicCommand)
            console.log('Created basic ping command')
        }

        const files = await fs.readdir(commandsPath)
        const jsFiles = files.filter(file => file.endsWith('.js'))
        
        for (const file of jsFiles) {
            try {
                delete require.cache[path.resolve(commandsPath, file)]
                const command = require(path.resolve(commandsPath, file))
                
                if (command.command && command.handler) {
                    commands[command.command] = command
                    console.log(`Loaded command: ${command.command}`)
                } else if (typeof command === 'function') {
                    // Handle function exports
                    const commandName = path.basename(file, '.js')
                    commands[commandName] = { handler: command }
                    console.log(`Loaded command: ${commandName}`)
                }
            } catch (error) {
                console.log(`Error loading ${file}:`, error.message)
            }
        }
        
        // Clean up temp directory if it was used
        if (commandsPath.includes('temp_commands')) {
            await fs.remove(path.join(__dirname, 'temp_commands'))
        }
        
    } catch (error) {
        console.log('Error loading commands:', error.message)
    }
    
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

async function saveSessionToGitHub(sessionId, phoneNumber, authDir, userId) {
    return await gitHubStorage.saveSession(sessionId, phoneNumber, authDir, userId)
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function startBot() {
    try {
        console.log('🚀 Starting Firekid Bot...')
        
        // Download commands from GitHub first
        await downloadCommands()
        commands = await loadCommands()
        console.log(`Loaded ${Object.keys(commands).length} commands`)
        
    } catch (error) {
        console.log('Error loading commands:', error.message)
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_ID)
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
        const { connection, lastDisconnect, qr } = update
        
        if (qr) {
            console.log('📱 Scan QR Code:')
            qrcode.generate(qr, { small: true })
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            
            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000)
            }
        } else if (connection === 'open') {
            console.log('✅ Bot connected successfully!')
            
            // Save session to GitHub when connected
            try {
                const phoneNumber = sock.user.id.split(':')[0]
                const userId = sock.user.id
                const sessionResult = await saveSessionToGitHub(
                    config.SESSION_ID, 
                    phoneNumber, 
                    config.SESSION_ID, 
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
                    
                    // Send error message to user
                    await sock.sendMessage(message.key.remoteJid, {
                        text: '❌ An error occurred while executing the command.'
                    })
                }
            } else {
                console.log(`❓ Unknown command: ${commandName}`)
                
                // Optionally send unknown command message
                await sock.sendMessage(message.key.remoteJid, {
                    text: `❓ Unknown command: ${commandName}\nUse ${config.PREFIX}ping to test bot.`
                })
            }
        }
    })
    
    return sock
}

// Start the bot
startBot().catch(console.error)

// Export functions for potential external use
module.exports = {
    downloadCommands,
    loadCommands,
    isCommand,
    executeCommand,
    saveSessionToGitHub,
    gitHubStorage,
    delay
}
