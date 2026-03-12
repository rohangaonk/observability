import os
import json
import time
from pyflink.datastream import StreamExecutionEnvironment
from pyflink.datastream.connectors.kafka import KafkaSource, KafkaOffsetsInitializer, KafkaSink, KafkaRecordSerializationSchema, DeliveryGuarantee
from pyflink.common.watermark_strategy import WatermarkStrategy
from pyflink.common.serialization import SimpleStringSchema
from pyflink.common.typeinfo import Types
from pyflink.datastream.window import TumblingProcessingTimeWindows
from pyflink.common.time import Time

# ─────────────────────────────────────────────────────────────────
# STREAM 1 — Metrics
# ─────────────────────────────────────────────────────────────────

def process_telemetry(data_string):
    """
    Parses an OTLP metrics batch (one Kafka message = one OTel batch).
    Returns a labeled counter tuple so we can aggregate by key.

    Output: ("metric_batches_received", 1)  for valid JSON
            ("parse_error",             1)  for malformed messages
    """
    try:
        json.loads(data_string)  # validate it's real OTLP JSON
        return ("metric_batches_received", 1)
    except Exception:
        return ("parse_error", 1)


# ─────────────────────────────────────────────────────────────────
# STREAM 2 — Logs  (filter → alert on ERROR/FATAL)
# ─────────────────────────────────────────────────────────────────

# OTLP severity numbers (defined in the OTel spec):
#   1–4   = TRACE
#   5–8   = DEBUG
#   9–12  = INFO
#   13–16 = WARN
#   17–20 = ERROR   ← we alert from here
#   21–24 = FATAL
ERROR_SEVERITY_THRESHOLD = 17

def classify_log_batch(data_string):
    """
    Parses an OTLP log batch and counts how many log records are
    ERROR severity or above across all resourceLogs in the batch.

    A single Kafka message contains one OTLP export request, which
    can include multiple resourceLogs → scopeLogs → logRecords.

    Output: ("ERROR", n)  if any ERROR/FATAL records found  — must be kept
            ("OK",    n)  for info-level batches             — will be filtered out
    """
    try:
        data = json.loads(data_string)
        error_count = 0
        total_count = 0

        # Walk the nested OTLP structure to reach individual log records
        for resource_log in data.get("resourceLogs", []):
            for scope_log in resource_log.get("scopeLogs", []):
                for record in scope_log.get("logRecords", []):
                    total_count += 1
                    severity = record.get("severityNumber", 0)
                    if severity >= ERROR_SEVERITY_THRESHOLD:
                        error_count += 1

        if error_count > 0:
            return ("ERROR", error_count)
        else:
            # Return total_count so we can see volume even for clean batches
            return ("OK", total_count)

    except Exception:
        return ("PARSE_ERROR", 1)


def is_error_batch(record):
    """
    filter() predicate — returns True only for ERROR/FATAL batches.

    This is the key step: it drops all ("OK", n) and ("PARSE_ERROR", n)
    records from the stream entirely. Only ERROR records flow downstream.
    filter() is stateless — it decides one record at a time, no memory.
    """
    return record[0] == "ERROR"


def format_alert(record):
    """
    Serializes a windowed alert tuple into a JSON string for the Kafka sink.

    Input:  ("ERROR", 4)   — the reduced tuple from the 60s window
    Output: '{"level": "ERROR", "count": 4, "window_seconds": 60, "ts": 1741772400}'

    Why JSON? Kafka stores raw bytes — the consumer decides how to interpret them.
    JSON is the standard choice for schema-light telemetry: human-readable,
    easy to parse in any language, and compatible with Grafana, OpenSearch, etc.

    The "ts" field is wall-clock time at the moment Flink emits the record.
    For processing-time windows this is also approximately when the window closed.
    """
    level, count = record
    alert = {
        "level": level,
        "count": count,
        "window_seconds": 60,
        "ts": int(time.time()),  # Unix epoch seconds
    }
    return json.dumps(alert)


def main():
    env = StreamExecutionEnvironment.get_execution_environment()

    # The Kafka connector JAR bundled into our custom flink-py image
    KAFKA_JAR_PATH = "file:///opt/flink/lib/flink-sql-connector-kafka-3.1.0-1.18.jar"
    env.add_jars(KAFKA_JAR_PATH)

    brokers = "kafka:29092"

    # ── Source 1: metrics ────────────────────────────────────────
    metrics_source = KafkaSource.builder() \
        .set_bootstrap_servers(brokers) \
        .set_topics("telemetry.metrics") \
        .set_group_id("flink-metrics-group") \
        .set_starting_offsets(KafkaOffsetsInitializer.latest()) \
        .set_value_only_deserializer(SimpleStringSchema()) \
        .build()

    # ── Source 2: logs ───────────────────────────────────────────
    logs_source = KafkaSource.builder() \
        .set_bootstrap_servers(brokers) \
        .set_topics("telemetry.logs") \
        .set_group_id("flink-logs-group") \
        .set_starting_offsets(KafkaOffsetsInitializer.latest()) \
        .set_value_only_deserializer(SimpleStringSchema()) \
        .build()

    metrics_stream = env.from_source(
        metrics_source, WatermarkStrategy.no_watermarks(), "Kafka Metrics Source"
    )
    logs_stream = env.from_source(
        logs_source, WatermarkStrategy.no_watermarks(), "Kafka Logs Source"
    )

    # ── Pipeline 1: metrics aggregation (10-second window) ───────
    #
    #   map  → label each batch as ("metric_batches_received", 1)
    #   keyBy → route by label so each key is reduced independently
    #   window → collect 10 seconds of records per key into one bucket
    #   reduce → sum the counts within the closed bucket → emit once
    metrics_windowed = metrics_stream \
        .map(process_telemetry, output_type=Types.TUPLE([Types.STRING(), Types.INT()])) \
        .key_by(lambda x: x[0], key_type=Types.STRING()) \
        .window(TumblingProcessingTimeWindows.of(Time.seconds(10))) \
        .reduce(lambda a, b: (a[0], a[1] + b[1]))

    # ── Pipeline 2: error log detection (60-second alert window) ─
    #
    #   map    → parse each log batch, count ERROR/FATAL records inside it
    #   filter → DISCARD any batch that has no errors (OK / PARSE_ERROR)
    #            Only ERROR batches continue downstream — this is the split.
    #   keyBy  → group all surviving ERROR tuples under the "ERROR" key
    #   window → collect 60 seconds of error counts into one bucket
    #   reduce → sum the error counts → emit one alert tuple per minute
    error_alerts = logs_stream \
        .map(classify_log_batch, output_type=Types.TUPLE([Types.STRING(), Types.INT()])) \
        .filter(is_error_batch) \
        .key_by(lambda x: x[0], key_type=Types.STRING()) \
        .window(TumblingProcessingTimeWindows.of(Time.seconds(60))) \
        .reduce(lambda a, b: (a[0], a[1] + b[1]))

    # ── Sink 1: metrics → stdout (human-readable, good for learning) ───
    # We keep metrics as a print sink for now — easy to verify in docker logs.
    # In Phase 4 we'll route this to Prometheus instead.
    metrics_windowed.map(lambda x: f"[METRICS] {x[0]}: {x[1]} batches/10s").print()

    # ── Sink 2: alerts → Kafka topic "telemetry.alerts" ─────────────────
    #
    # KafkaSink is the write counterpart of KafkaSource.
    # KafkaRecordSerializationSchema defines how a Flink record becomes a Kafka message:
    #   - set_topic: every alert goes to the same topic
    #   - set_value_serialization_schema: encode the string as UTF-8 bytes
    #     (Kafka stores raw bytes — the schema tells Flink how to produce them)
    #
    # DeliveryGuarantee.AT_LEAST_ONCE:
    #   Flink will retry on failure, so a message might be delivered more than once
    #   but will never be lost. This is the right default for alerts.
    #   EXACTLY_ONCE is also available but requires Kafka transactions + checkpointing
    #   — more overhead, only worth it for financial/billing data.
    alert_sink = KafkaSink.builder() \
        .set_bootstrap_servers(brokers) \
        .set_record_serializer(
            KafkaRecordSerializationSchema.builder() \
                .set_topic("telemetry.alerts") \
                .set_value_serialization_schema(SimpleStringSchema()) \
                .build()
        ) \
        .set_delivery_guarantee(DeliveryGuarantee.AT_LEAST_ONCE) \
        .build()

    # Serialize each alert tuple to JSON, then write to Kafka
    error_alerts \
        .map(format_alert, output_type=Types.STRING()) \
        .sink_to(alert_sink)

    print("Submitting job: Telemetry Processing Pipeline...")
    env.execute("Telemetry Processing Pipeline")

if __name__ == '__main__':
    main()
