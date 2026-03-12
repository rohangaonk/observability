FROM flink:1.18.1-scala_2.12-java11

# Install Python and pip
# PyFlink requires Python 3.8, 3.9, or 3.10
RUN apt-get update -y && \
    apt-get install -y python3 python3-pip python3-dev openjdk-11-jdk && \
    ln -s /usr/bin/python3 /usr/bin/python && \
    rm -rf /var/lib/apt/lists/*

# Set JAVA_HOME correctly for pemja installation to succeed
ENV JAVA_HOME=/usr/lib/jvm/java-11-openjdk-arm64
ENV PATH=$JAVA_HOME/bin:$PATH

# Install PyFlink and any other Python dependencies
# We use the same version as the base Flink image
COPY requirements.txt /opt/flink/requirements.txt
RUN pip3 install --no-cache-dir -r /opt/flink/requirements.txt

# Download the Flink SQL connector for Kafka
# This JAR file is required for Flink to talk to Kafka
RUN wget -P /opt/flink/lib/ https://repo.maven.apache.org/maven2/org/apache/flink/flink-sql-connector-kafka/3.1.0-1.18/flink-sql-connector-kafka-3.1.0-1.18.jar

# Define default command
CMD ["help"]
