FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required for audio processing (libsndfile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install python packages
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files and model directories into the container
COPY . /app

# Create necessary directories for persistent data and models
RUN mkdir -p /app/data /app/models

# Expose ports: 10400 for Wyoming TCP stream, 8000 for FastAPI HTTP management
EXPOSE 10400
EXPOSE 8000

CMD ["python", "server.py"]