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
        cp -r temp_commands/* commands/ 2>/dev/null || cp -r temp_commands/. commands/ && \
        rm -rf temp_commands && \
        echo "Commands cloned successfully"; \
    else \
        echo "Commands directory exists and has content"; \
    fi

RUN echo "Final commands structure:" && \
    ls -la commands/ && \
    if [ -f "commands/index.js" ]; then \
        echo "✅ Commands index.js exists" && \
        head -10 commands/index.js; \
    else \
        echo "❌ Commands index.js missing"; \
    fi

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
