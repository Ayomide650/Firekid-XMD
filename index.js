const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const qrcode = require('qrcode-terminal')
const pino = require('pino')
const NodeCache = require('node-cache')
const fs = require('fs-extra')
const path = require('path')
const axios = require('axios')
const config = require('./config')
const { downloadCommands, loadCommands, isCommand, executeCommand } = require('./lib/helper')

const msgRetryCounterCache = new NodeCache()
const logger = pino({ level: 'silent' })

let commands = {}

async function startBot() {
    try {
        await downloadCommands()
        commands = await loadCommands()
        console.log(`Loaded ${Object.keys(commands).length} commands`)
    } catch (error) {
        console.log('Error loading commands:', error.message)
    }

    const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_ID)
    const { version, isLatest } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        auth: state,
        msgRetryCounterCache,
        defaultQueryTimeoutMs: 60000,
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)

            if (shouldReconnect) {
                startBot()
            }
        } else if (connection === 'open') {
            console.log('Bot connected successfully!')
        }
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('messages.upsert', async (m) => {
        const message = m.messages[0]
        
        if (!message.message || message.key.fromMe) return
        
        const messageText = message.message.conversation || 
                           message.message.extendedTextMessage?.text || ''
        
        if (isCommand(messageText, config.PREFIX)) {
            const commandName = messageText.slice(config.PREFIX.length).trim().split(' ')[0].toLowerCase()
            
            if (commands[commandName]) {
                try {
                    await executeCommand(commands[commandName], sock, message)
                } catch (error) {
                    console.log('Error executing command:', error)
                }
            }
        }
    })

    return sock
}

startBot().catch(console.error)
