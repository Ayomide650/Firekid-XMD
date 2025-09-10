const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto') // Add this import

/**
 * Download commands - simplified for Docker deployment
 */
async function downloadCommands() {
    try {
        // Create commands directory if it doesn't exist
        const commandsDir = path.join(__dirname, '../commands')
        await fs.ensureDir(commandsDir)
        
        console.log('Commands directory ready')
        return true
    } catch (error) {
        console.log('Error downloading commands:', error.message)
        return false
    }
}

/**
 * Load all command files from the commands directory
 */
async function loadCommands() {
    const commands = {}
    const commandsDir = path.join(__dirname, '../commands')
    
    try {
        // Check if commands directory exists
        if (!await fs.pathExists(commandsDir)) {
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
            await fs.ensureDir(commandsDir)
            await fs.writeFile(path.join(commandsDir, 'ping.js'), basicCommand)
            console.log('Created basic ping command')
        }

        const files = await fs.readdir(commandsDir)
        const jsFiles = files.filter(file => file.endsWith('.js'))
        
        for (const file of jsFiles) {
            try {
                const commandPath = path.join(commandsDir, file)
                delete require.cache[path.resolve(commandPath)]
                const command = require(commandPath)
                
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
    } catch (error) {
        console.log('Error loading commands:', error.message)
    }
    
    return commands
}

/**
 * Check if text is a command
 */
function isCommand(text, prefix) {
    return text && typeof text === 'string' && text.startsWith(prefix)
}

/**
 * Execute a command
 */
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

/**
 * Simple delay function
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Generate session ID
 */
function generateSessionId() {
    return crypto.randomBytes(16).toString('hex')
}

module.exports = {
    downloadCommands,
    loadCommands,
    isCommand,
    executeCommand,
    delay,
    generateSessionId
}
