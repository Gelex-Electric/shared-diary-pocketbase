FROM ghcr.io/muchobien/pocketbase:latest

# Copy giao diện nhật ký vào image
COPY pb_public /pb_public

# Expose port
EXPOSE 8090

# CMD đúng cách cho image muchobien (rất quan trọng!)
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb_data", "--publicDir=/pb_public"]
# Trigger redeploy để lấy token pbinstall mới - 2026-03-09