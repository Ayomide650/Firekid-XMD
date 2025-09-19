FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    librsvg-dev

COPY package*.json ./

RUN npm install --production

COPY . .

RUN if [ ! -d "commands" ] || [ -z "$(ls -A commands 2>/dev/null)" ]; then \
        echo "Commands directory empty or missing, cloning..." && \
        rm -rf commands && \
        git clone https://github.com/idc-what-u-think/Firekid-MD-.git temp_commands && \
        mv temp_commands commands && \
        echo "Commands cloned successfully"; \
    else \
        echo "Commands directory exists and has content"; \
    fi

RUN if [ -d "commands" ] && [ ! -f "commands/index.js" ]; then \
        echo "Creating commands index.js..." && \
        cat > commands/index.js << 'EOF'
const fs = require('fs')
const path = require('path')

const commands = {}

try {
    const commandFiles = fs.readdirSync(__dirname).filter(file => 
        file.endsWith('.js') && file !== 'index.js'
    )

    for (const file of commandFiles) {
        const commandName = path.basename(file, '.js')
        try {
            const command = require(path.join(__dirname, file))
            commands[commandName] = command
            console.log(`✅ Loaded command: ${commandName}`)
        } catch (error) {
            console.error(`❌ Failed to load command ${commandName}:`, error.message)
        }
    }
} catch (error) {
    console.error('Error reading commands directory:', error.message)
}

module.exports = commands
EOF
    fi

RUN ls -la commands/ && echo "Commands directory contents listed"

RUN mkdir -p temp_sessions

ENV NODE_ENV=production
ENV SESSION_ID=firekid_session
ENV PREFIX=.

EXPOSE 3000

RUN addgroup -g 1001 -S nodejs && \
    adduser -S firekid -u 1001 -G nodejs && \
    chown -R firekid:nodejs /app

USER firekid

CMD ["node", "index.js"]
