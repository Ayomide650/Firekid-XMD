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

# Copy package files first
COPY package*.json ./

# Set build arg for GitHub token
ARG GITHUB_TOKEN
ENV GITHUB_TOKEN=${GITHUB_TOKEN}

# Initialize git and clone submodule
COPY .gitmodules ./
RUN git init && \
    git config --global user.email "bot@example.com" && \
    git config --global user.name "Bot" && \
    git remote add origin https://${GITHUB_TOKEN}@github.com/your-main-repo/your-bot-repo.git || true && \
    git submodule add https://${GITHUB_TOKEN}@github.com/idc-what-u-think/Firekid-MD-.git commands && \
    git submodule update --init --recursive

# Install dependencies
RUN npm install --production

# Copy rest of the application
COPY . .

# Create temp sessions directory
RUN mkdir -p temp_sessions

# Set environment variables
ENV NODE_ENV=production
ENV SESSION_ID=firekid_session
ENV PREFIX=.

EXPOSE 3000

# Create user and set permissions
RUN addgroup -g 1001 -S nodejs
RUN adduser -S firekid -u 1001
RUN chown -R firekid:nodejs /app

USER firekid

CMD ["node", "index.js"]
