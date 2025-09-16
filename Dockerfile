FROM node:18-alpine

WORKDIR /app

# Install system dependencies
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

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the entire project
COPY . .

# Clone the commands repository (public)
RUN if [ ! -d "commands" ] || [ -z "$(ls -A commands)" ]; then \
        rm -rf commands && \
        git clone https://github.com/idc-what-u-think/Firekid-MD-.git commands; \
    fi

# Create temp sessions directory
RUN mkdir -p temp_sessions

# Set environment variables
ENV NODE_ENV=production
ENV SESSION_ID=firekid_session
ENV PREFIX=.

EXPOSE 3000

# Create user and set permissions
RUN addgroup -g 1001 -S nodejs && \
    adduser -S firekid -u 1001 -G nodejs && \
    chown -R firekid:nodejs /app

USER firekid

CMD ["node", "index.js"]
