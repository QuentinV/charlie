FROM alpine:latest

RUN apk add --no-cache mpv socat

CMD mpv --idle --no-terminal --input-ipc-server=/tmp/mpvsocket & \
    socat TCP-LISTEN:7777,reuseaddr,fork UNIX-CONNECT:/tmp/mpvsocket