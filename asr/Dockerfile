FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    bzip2 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir \
    sherpa-onnx>=1.10.0 \
    wyoming>=1.5.0 \
    numpy

COPY server.py /app/
COPY entrypoint.sh /app/

RUN chmod +x /app/entrypoint.sh

EXPOSE 10300

ENTRYPOINT ["/app/entrypoint.sh"]