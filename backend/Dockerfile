FROM node:20-alpine

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose backend port
EXPOSE 5000

# Run Express server (which automatically runs preload before starting)
CMD ["node", "server.js"]
