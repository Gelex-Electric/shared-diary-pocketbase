#!/bin/sh
set -e

echo "🚀 Khởi động PocketBase..."
./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  > /dev/stdout 2>&1 &

echo "⏳ Đợi PocketBase khởi động 15 giây..."
sleep 15

echo "🚀 Khởi động React + Express..."
npx tsx server.ts
