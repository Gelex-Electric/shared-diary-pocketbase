# Stage 1: Build React
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production (PocketBase + Node)
FROM node:20-alpine
WORKDIR /app

# Cài PocketBase binary (phiên bản khớp SDK 0.26)
RUN apk add --no-cache curl unzip && \
    curl -L https://github.com/pocketbase/pocketbase/releases/download/v0.26.0/pocketbase_0.26.0_linux_amd64.zip -o pb.zip && \
    unzip pb.zip && \
    rm pb.zip && \
    chmod +x pocketbase

# Copy build + code
COPY --from=builder /app/dist ./dist
COPY server.ts ./
COPY package*.json ./
COPY start.sh ./

RUN npm ci --only=production && npm install tsx
RUN chmod +x start.sh

VOLUME ["/app/pb_data"]

EXPOSE 3000
EXPOSE 8090

CMD ["./start.sh"]
