FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source
COPY . .

# Environment
ENV NODE_ENV=production \
    PORT=3000

# Create storage directory if not present
RUN mkdir -p storage

EXPOSE 3000
CMD ["node", "server.js"]


