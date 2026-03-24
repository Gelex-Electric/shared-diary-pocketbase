# ==================== BUILD STAGE ====================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (dev + prod)
RUN npm ci --frozen-lockfile

# Copy toàn bộ source code
COPY . .

# Build React app (tạo thư mục dist/)
RUN npm run build

# ==================== PRODUCTION STAGE ====================
FROM node:20-alpine

WORKDIR /app

# Copy kết quả build và server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/package*.json ./

# Chỉ install production dependencies (nhỏ gọn)
RUN npm ci --only=production --frozen-lockfile

# Railway sẽ tự inject biến $PORT
EXPOSE 3000

# Chạy bằng script "start" trong package.json (tsx server.ts)
CMD ["npm", "start"]
