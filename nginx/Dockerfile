FROM nginx:alpine

# Runs as root (unlike other app images) — it must bind container port 80,
# which is a privileged port an unprivileged UID cannot bind to.
RUN apk add --no-cache curl

COPY nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
