# Sử dụng image Go để build ứng dụng
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o main .

# Sử dụng image nhẹ để chạy ứng dụng
FROM alpine:latest
RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /app/main /app/main

# Tạo thư mục cho dữ liệu PocketBase
RUN mkdir /app/pb_data

# Railway cung cấp biến môi trường PORT
EXPOSE $PORT

# Lệnh chạy ứng dụng, trỏ dữ liệu vào pb_data và lắng nghe cổng của Railway
CMD ["./main", "serve", "--http=0.0.0.0:$PORT", "--dir=/app/pb_data"]
