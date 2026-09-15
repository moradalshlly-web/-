FROM node:22-bookworm
ARG RUNNER_VERSION=2.337.0
ARG RUNNER_SHA256=70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613
RUN apt-get update && apt-get install -y --no-install-recommends sudo jq git curl ca-certificates xz-utils zstd libicu72 libssl3 zlib1g libkrb5-3 fonts-dejavu-core fonts-liberation && rm -rf /var/lib/apt/lists/*
RUN corepack enable npm && corepack prepare npm@11.12.1 --activate
RUN useradd -m -s /bin/bash runner && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
WORKDIR /home/runner/actions-runner
RUN curl -fsSL "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" -o /tmp/runner.tgz && echo "${RUNNER_SHA256}  /tmp/runner.tgz" | sha256sum -c - && tar xzf /tmp/runner.tgz && rm /tmp/runner.tgz && chown -R runner:runner /home/runner
COPY --chown=runner:runner runner-entrypoint.sh job-started.sh /home/runner/
RUN chmod 755 /home/runner/runner-entrypoint.sh /home/runner/job-started.sh
ENV VITEST_MAX_WORKERS=2
ENV ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/runner/job-started.sh
USER runner
ENTRYPOINT ["bash", "/home/runner/runner-entrypoint.sh"]
