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

# Install dependencies
RUN npm install --production


COPY . .


RUN mkdir -p temp_sessions

# Set environment variables
ENV NODE_ENV=production
ENV SESSION_ID=firekid_session
ENV PREFIX=.


EXPOSE 3000


RUN addgroup -g 1001 -S nodejs
RUN adduser -S firekid -u 1001


RUN chown -R firekid:nodejs /app
USER firekid


CMD ["node", "index.js"]
