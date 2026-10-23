# ---------------------------------------------------------------
#  PulseBoard container image
# ---------------------------------------------------------------
# 1. Start from a small official Node.js image (Debian "slim").
FROM node:24-slim

# 2. Run in production mode (smaller installs, faster Express).
ENV NODE_ENV=production

# 3. Everything lives in /app inside the container.
WORKDIR /app

# 4. Copy ONLY the dependency files first. Docker caches this layer,
#    so `npm ci` re-runs only when package*.json changes.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 5. Now copy the rest of the source code.
COPY . .

# 6. Don't run as root. The node image ships a "node" user.
USER node

# 7. Cloud Run sends traffic to $PORT (8080 by default).
#    EXPOSE is documentation; the app reads $PORT itself.
ENV PORT=8080
EXPOSE 8080

# 8. Start the server. Using `node` directly (not `npm start`) means
#    SIGTERM from Cloud Run reaches our code for a clean shutdown.
CMD ["node", "server.js"]
