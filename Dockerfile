FROM ghcr.io/muchobien/pocketbase:latest

# Copy folder giao diện vào image
COPY pb_public /pb_public

# Expose port
EXPOSE 8090

# Chạy PocketBase với publicDir (rất quan trọng!)
CMD ["/usr/local/bin/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb_data", "--publicDir=/pb_public"]