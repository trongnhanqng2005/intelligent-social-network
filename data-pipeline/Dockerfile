FROM python:3.12-slim-bookworm@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d AS pydeps

ENV VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    TMPDIR=/tmp/etl-build-tmp

WORKDIR /build
COPY pyproject.toml requirements.lock requirements-build.lock ./
COPY wheelhouse/ /opt/wheelhouse/

RUN set -eux; \
    python -m venv /opt/venv; \
    mkdir -p /tmp/etl-build-tmp; \
    chmod 1777 /tmp/etl-build-tmp; \
    python -m pip install --no-cache-dir --no-index --find-links=/opt/wheelhouse \
        --require-hashes --no-deps -r requirements-build.lock; \
    python -m pip install --no-cache-dir --no-index --find-links=/opt/wheelhouse \
        --require-hashes --no-build-isolation -r requirements.lock; \
    python -m pip check; \
    python -c 'import py4j, pyspark; assert pyspark.__version__ == "3.5.9"; assert py4j.__version__ == "0.10.9.7"'; \
    python -m pip uninstall --yes setuptools wheel; \
    rm -rf /opt/wheelhouse /tmp/etl-build-tmp

FROM python:3.12-slim-bookworm@sha256:2ed6491b93cd49272ee6de2b5a38440c3448360322c089fc23e370722d74179d AS runtime

ARG OPENJDK17_VERSION=17.0.20.1+1-1~deb12u1

# Keep Snappy's native library off Docker's commonly noexec /tmp mount.
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv \
    PYSPARK_PYTHON=/opt/venv/bin/python \
    PYSPARK_DRIVER_PYTHON=/opt/venv/bin/python \
    PATH="/opt/venv/bin:/usr/lib/jvm/java-17-openjdk-amd64/bin:${PATH}" \
    SPARK_LOCAL_IP=127.0.0.1 \
    SPARK_LOCAL_DIRS=/tmp/spark-local \
    TMPDIR=/tmp \
    SNAPPY_NATIVE_TMPDIR=/run/isn-etl-snappy \
    JAVA_TOOL_OPTIONS="-Dorg.xerial.snappy.tempdir=/run/isn-etl-snappy"

RUN set -eux; \
    apt-get update; \
    apt-get install --yes --no-install-recommends \
        "openjdk-17-jdk-headless=${OPENJDK17_VERSION}" \
        ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    java -version; \
    python --version

COPY --from=pydeps /opt/venv /opt/venv

RUN set -eux; \
    groupadd --system --gid 10001 etl; \
    useradd --system --uid 10001 --gid etl --home-dir /home/etl \
        --create-home --shell /usr/sbin/nologin etl; \
    install -d --owner=etl --group=etl /opt/isn-etl /output; \
    install -d --owner=etl --group=etl --mode=0700 /run/isn-etl-snappy

USER 10001:10001
ENV HOME=/home/etl
WORKDIR /opt/isn-etl

CMD ["python", "--version"]

FROM runtime AS pipeline

COPY --chown=10001:10001 src/ /opt/isn-etl/src/
ENV PYTHONPATH=/opt/isn-etl/src
CMD ["python", "-m", "isn_etl"]
