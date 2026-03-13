# Observability Practice Project Roadmap

## Project Intent & Context
This project is dedicated to learning and practicing modern observability tools in a simulated, realistic environment. The ultimate aim is to understand how telemetry data (logs, metrics, and traces) flows from an application through a data pipeline to be processed and visualized.

We are simulating a production-grade observability stack, moving away from simple console logging to structured, distributed telemetry. This roadmap serves as the source of truth for any new session to quickly grasp the project's goals and current state.

## Core Technologies
*   **Primary Application:** Node.js / NestJS (Simulating a backend service generating traffic and telemetry).
*   **Instrumentation:** OpenTelemetry (OTel) Node.js SDK for standardizing and emitting traces, metrics, and logs.
*   **Collector:** OpenTelemetry Collector for receiving, filtering, and routing telemetry data.
*   **Message Broker:** Apache Kafka to decouple the data generation from the processing layer.
*   **Stream Processing:** Apache Flink for real-time aggregation, pattern detection, and processing of log streams.
*   **Visualization/Storage:** Jaeger (Tracing), Prometheus (Metrics), Grafana (Dashboards), Grafana Loki (Log Storage), Grafana Tempo (Trace Storage).

## Desired Outcomes
1.  **Practical Mastery of OpenTelemetry:** Learn how to auto-instrument and manually instrument a Node.js/NestJS application to emit W3C-compliant traces and structured logs.
2.  **Pipeline Architecture:** Understand the role of the OTel Collector as a vendor-agnostic proxy.
3.  **Real-time Processing:** Gain experience with Apache Flink to analyze streaming logs (e.g., detecting error spikes, filtering noise) as they flow through Kafka.
4.  **End-to-End Visibility:** Successfully visualize the journey of a request from the NestJS app through the entire infrastructure.
5.  **Log Storage & Querying:** Understand how Loki stores logs differently from Elasticsearch (label-based indexing), and write LogQL queries to explore log data.
6.  **Closing the Flink Loop:** Persist Flink-generated alerts (currently dropped on the floor) into Loki so they are queryable and visible in Grafana.
7.  **Unified Correlation:** Link metrics, traces, and logs in Grafana so a single anomaly can be investigated across all three pillars without switching tools.

---

## Implementation Phases

### Phase 1: Foundation & Telemetry Generation
*   [x] Initialize a basic Node.js / NestJS application.
*   [x] Implement a Log/Traffic Simulator within the app to generate realistic API requests, varying latencies, and occasional errors.
*   [x] Integrate the **OpenTelemetry Node.js SDK** to instrument the application (Traces and structured Logs).
*   [x] Set up a local `docker-compose.yml` with the **OpenTelemetry Collector**.
*   [x] Configure the Collector to receive data from NestJS and export it (initially to the console/file for verification).
*   [x] Add local visualization (e.g. Jaeger) to verify trace generation.

### Phase 2: Decoupling with a Message Broker (Kafka)
*   [x] Add **Apache Kafka** to the `docker-compose.yml` stack.
*   [x] Reconfigure the OpenTelemetry Collector to export logs and metrics to a specific Kafka topic instead of just standard out.
*   [x] Verify data flows into Kafka correctly using a simple console consumer or a UI like Kafka-UI.

### Phase 3: Real-Time Stream Processing (Apache Flink)
*   [x] Add **Apache Flink** (JobManager and TaskManager) to the Docker Compose setup.
*   [x] Write a Flink job to consume the telemetry stream from Kafka.
*   [x] Implement stream processing logic in the Flink job:
    *   [x] Windowing (10-second tumbling windows aggregating metrics batches received).
    *   [x] Filtering (isolating `ERROR`/`FATAL` logs by OTLP `severityNumber >= 17`).
    *   [x] Alert generation / Routing (60-second error count window → `telemetry.alerts` Kafka topic via `KafkaSink`).

### Phase 4: Full System Visualization
*   [x] Deploy visualization tools via Docker Compose (**Prometheus** for metrics, **Grafana** for dashboards).
*   [x] Route raw metrics from the OTel Collector to Prometheus (via `prometheus` exporter on port 8889).
*   [x] Build a dashboard to observe the simulated application's health, throughput, and error rates in real-time.

### Phase 5: Log Storage with Loki (OTel Collector → Loki)
*   [ ] Deploy **Grafana Loki** via Docker Compose.
*   [ ] Add the `loki` exporter to the OTel Collector pipeline so raw logs flow directly: `NestJS → OTel Collector → Loki`.
*   [ ] Add Loki as a datasource in Grafana.
*   [ ] Write basic **LogQL** queries in Grafana Explore to filter logs by severity, service name, and time range.

### Phase 6: Close the Flink Loop (Flink Alerts → Loki)
*   [ ] Write a Loki HTTP push consumer in the Flink job that reads from the `telemetry.alerts` Kafka topic.
*   [ ] Push Flink-generated alert records into Loki under a dedicated label (e.g. `job="flink-alerts"`).
*   [ ] Verify in Grafana: Loki holds both raw app logs (from Collector) and processed alert events (from Flink) — query and compare them.

### Phase 7: Trace Storage with Tempo + Unified Correlation
*   [ ] Deploy **Grafana Tempo** via Docker Compose as the trace backend.
*   [ ] Reconfigure the OTel Collector to export traces to Tempo (replacing or alongside Jaeger).
*   [ ] Configure Grafana datasource links: Loki → Tempo (click a trace ID in a log line → jump to the trace).
*   [ ] Configure Prometheus exemplars → Tempo (click a metrics spike → jump to a representative trace).
*   [ ] Explore a full correlation flow in Grafana: metrics spike → trace → logs for that request.

---
**Note for future sessions:**
* Read this `roadmap.md` to understand current progress. Mark the checkboxes `[x]` as we complete each step.
* All infrastructure should be kept locally runnable via Docker Compose.
* Current architecture: `NestJS → OTel Collector → [Kafka → Flink → telemetry.alerts (Kafka, unread)], [Prometheus → Grafana], [Jaeger]`. Next: Phase 5 — add Loki.
