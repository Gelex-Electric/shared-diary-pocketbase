FROM pocketbase/pocketbase:latest

EXPOSE 8090
CMD ["/usr/local/bin/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb_data"]