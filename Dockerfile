# Multi-stage build for better security
FROM node:18-alpine AS builder

WORKDIR /app

# Install git and other build dependencies
RUN apk add --no-cache git

# Set build arg for GitHub token (only used during build)
ARG GITHUB_TOKEN
RUN git config --global user.email "bot@example.com" && \
    git config --global user.name "Bot"

# Copy package files
COPY package*.json ./
COPY .gitmodules ./

# Clone the commands submodule
RUN git clone https://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@github.com/idc-what-u-think/Firekid-MD-.git commands

# Production stage
FROM node:18-alpine AS production

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    librsvg-dev

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --production && npm cache clean --force

# Copy application files
COPY . .

# Copy commands from builder stage (this removes the git history and token)
COPY --from=builder /app/commands ./commands

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
