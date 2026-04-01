export const renderPlaywrightBrowserDockerfile = (): string =>
  `FROM kechangdev/browser-vnc:latest

# bash for noVNC startup, procps for ps -p used by novnc_proxy, socat for CDP proxy
# python3/net-tools for diagnostics
RUN apk add --no-cache bash procps socat python3 net-tools

COPY mcp-playwright-start-extra.sh /usr/local/bin/mcp-playwright-start-extra.sh
RUN chmod +x /usr/local/bin/mcp-playwright-start-extra.sh

# Start extra services in background, keep base stack in foreground
# Clear stale Chromium profile locks before boot
ENTRYPOINT ["/bin/sh", "-lc", "rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true; /usr/local/bin/mcp-playwright-start-extra.sh & exec /start.sh"]`

export const renderPlaywrightStartExtra = (): string =>
  `#!/bin/sh
set -eu

# Clear stale Chromium locks from previous container runs
rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true

# Wait for chromium/x11vnc/noVNC to come up
sleep 2

# CDP proxy: expose 9223 on the docker network, forward to 127.0.0.1:9222 inside the browser container
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/var/log/socat-9223.log 2>&1 &

# Optional VNC password disabling (useful if you publish VNC/noVNC ports)
if [ "\${VNC_NOPW:-1}" = "1" ]; then
  pkill x11vnc || true
  x11vnc -display :99 -rfbport 5900 -nopw -forever -shared -bg -o /var/log/x11vnc-nopw.log
fi

echo "extra services started"
exit 0
`
