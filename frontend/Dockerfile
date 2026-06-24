FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy application files
COPY . .

# Expose frontend port
EXPOSE 3000

# Start Vite dev server in host mode
CMD ["npm", "run", "dev"]
