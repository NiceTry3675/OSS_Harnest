FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HARNEST_DB=/data/harnest.db

WORKDIR /app

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/main.py apps/api/ratelimit.py ./

RUN mkdir -p /data

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
