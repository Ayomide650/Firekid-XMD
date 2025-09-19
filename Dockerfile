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
        echo "const fs = require('fs')" > commands/index.js && \
        echo "const path = require('path')" >> commands/index.js && \
        echo "" >> commands/index.js && \
        echo "const commands = {}" >> commands/index.js && \
        echo "" >> commands/index.js && \
        echo "try {" >> commands/index.js && \
        echo "    const commandFiles = fs.readdirSync(__dirname).filter(file => " >> commands/index.js && \
        echo "        file.endsWith('.js') && file !== 'index.js'" >> commands/index.js && \
        echo "    )" >> commands/index.js && \
        echo "" >> commands/index.js && \
        echo "    for (const file of commandFiles) {" >> commands/index.js && \
        echo "        const commandName = path.basename(file, '.js')" >> commands/index.js && \
        echo "        try {" >> commands/index.js && \
        echo "            const command = require(path.join(__dirname, file))" >> commands/index.js && \
        echo "            commands[commandName] = command" >> commands/index.js && \
        echo "            console.log(\`✅ Loaded command: \${commandName}\`)" >> commands/index.js && \
        echo "        } catch (error) {" >> commands/index.js && \
        echo "            console.error(\`❌ Failed to load command \${commandName}:\`, error.message)" >> commands/index.js && \
        echo "        }" >> commands/index.js && \
        echo "    }" >> commands/index.js && \
        echo "} catch (error) {" >> commands/index.js && \
        echo "    console.error('Error reading commands directory:', error.message)" >> commands/index.js && \
        echo "}" >> commands/index.js && \
        echo "" >> commands/index.js && \
        echo "module.exports = commands" >> commands/index.js; \
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
