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
        mv temp_commands/commands ./commands && \
        rm -rf temp_commands && \
        echo "Commands cloned successfully"; \
    else \
        echo "Commands directory exists, checking structure..." && \
        if [ -d "commands/commands" ] && [ ! -f "commands/index.js" ]; then \
            echo "Found nested commands, moving up..." && \
            mv commands/commands/* commands/ && \
            rmdir commands/commands; \
        fi; \
    fi

RUN echo "Final commands structure:" && \
    ls -la commands/ && \
    echo "JavaScript files in commands:" && \
    find commands/ -name "*.js" -type f && \
    if [ -f "commands/index.js" ]; then \
        echo "✅ Commands index.js exists" && \
        echo "First 5 lines:" && \
        head -5 commands/index.js; \
    else \
        echo "❌ Commands index.js missing"; \
    fi

RUN printf 'const fs = require("fs")\nconst path = require("path")\n\nconst commands = {}\n\nconst commandList = [\n    "sudo", "warn", "resetwarning", "allowdomain", "menu", "ping", "alive",\n    "vv", "delete", "kick", "tagall", "promote", "mute", "unmute", "left",\n    "tag", "join", "setgrppp", "antilnk", "sticker", "toimg", "filter",\n    "country", "kill", "online", "block", "ttdownload", "song", "lyrics",\n    "weather", "movie"\n]\n\ncommandList.forEach(commandName => {\n    const filePath = path.join(__dirname, `${commandName}.js`)\n    \n    try {\n        if (fs.existsSync(filePath)) {\n            commands[commandName] = require(`./${commandName}`)\n            console.log(`✅ Loaded: ${commandName}`)\n        } else {\n            console.log(`⚠️ Missing: ${commandName}.js`)\n        }\n    } catch (error) {\n        console.error(`❌ Error loading ${commandName}:`, error.message)\n    }\n})\n\nconsole.log(`📋 Total commands loaded: ${Object.keys(commands).length}`)\n\nmodule.exports = commands\n' > commands/index.js

RUN mkdir -p temp_sessions

RUN if [ -d "sessions" ]; then \
        echo "Moving existing sessions to temp_sessions..." && \
        cp -r sessions/* temp_sessions/ 2>/dev/null || true; \
    fi

ENV NODE_ENV=production
ENV SESSION_ID=firekid_session
ENV PREFIX=.

EXPOSE 3000

RUN addgroup -g 1001 -S nodejs && \
    adduser -S firekid -u 1001 -G nodejs && \
    chown -R firekid:nodejs /app

USER firekid

CMD ["node", "index.js"]
