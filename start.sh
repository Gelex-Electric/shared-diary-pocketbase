#!/bin/sh
set -e

echo "🚀 Khởi động PocketBase..."
./pocketbase serve \
  --http=0.0.0.0:8090 \
  --dir=/app/pb_data \
  > /dev/stdout 2>&1 &

echo "⏳ Đợi PocketBase sẵn sàng..."
i=0
until curl -sf http://localhost:8090/api/health > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "❌ PocketBase không phản hồi sau 60 giây, thoát."
    exit 1
  fi
  sleep 1
done
echo "✅ PocketBase đã sẵn sàng sau ${i} giây."

# Tạo hoặc cập nhật superuser từ biến môi trường
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  echo "🔑 Thiết lập superuser PocketBase..."
  ./pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/app/pb_data
fi

echo "🚀 Khởi động React + Express..."
npx tsx server.ts
