FROM ghcr.io/muchobien/pocketbase:latest

# Expose port cho Railway
EXPOSE 8090

# Chạy PocketBase với volume data
CMD ["/usr/local/bin/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb_data"]