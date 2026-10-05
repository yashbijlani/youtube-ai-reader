# Production image for the YouTube AI Reader backend (Cloud Run).
#
# Persistent state lives in Supabase; this container is stateless. The local
# filesystem is only used as a cache under DATA_DIR.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/tmp/yair-data \
    PORT=8080 \
    HOST=0.0.0.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN mkdir -p /tmp/yair-data && chown -R appuser:appuser /tmp/yair-data /app
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/api/health', timeout=4)"

# FastAPI lifespan handles graceful startup/shutdown (closing the AI provider,
# the store and in-flight jobs). uvicorn passes SIGTERM through on deploy.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
