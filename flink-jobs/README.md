# Flink Jobs

This folder contains our stream processing jobs written for Apache Flink.

Since Flink's native languages are Java and Scala, and later Python (PyFlink), there is no official Node.js SDK for writing Flink processing logic. Therefore, we use Python here, which offers a great balance of brevity and power for stream processing.

## Running

We will run these jobs using PyFlink.

## Current pipeline behavior

- Consumes `telemetry.metrics` from Kafka for 10-second metric-batch aggregation.
- Consumes `telemetry.logs` from Kafka, filters `ERROR/FATAL` records, and emits 60-second alert summaries to `telemetry.alerts`.
- Consumes `telemetry.alerts` from Kafka and forwards each alert to Loki using HTTP `POST /loki/api/v1/push`.

## Environment variables used by `job.py`

- `LOKI_PUSH_URL` (default: `http://loki:3100/loki/api/v1/push`) — Loki ingestion endpoint.
- `LOKI_PUSH_TIMEOUT_SECONDS` (default: `2`) — per-request HTTP timeout for Loki push.
- `OBS_ENV` (default: `local`) — added as a Loki label to distinguish environments.
