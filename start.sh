#!/bin/sh
set -e

echo "🚀 Khởi động PocketBase..."
./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  --publicUrl=https://getc.up.railway.app/pb \
  > /dev/stdout 2>&1 &

sleep 5

echo "🚀 Khởi động React + Express..."
npx tsx server.ts
