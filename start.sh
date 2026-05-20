#!/bin/sh
set -e

echo "🚀 Khởi động PocketBase..."
./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  > /dev/stdout 2>&1 &

echo "⏳ Đợi PocketBase khởi động 15 giây..."
sleep 15

# Tạo hoặc cập nhật superuser từ biến môi trường
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  echo "🔑 Thiết lập superuser PocketBase..."
  ./pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/app/pb_data
fi

echo "🚀 Khởi động React + Express..."
npx tsx server.ts
