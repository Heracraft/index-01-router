#!/usr/bin/env bash
# Runs the headless Obsidian REST/MCP server in Docker against a vault folder, for development
# and for src/lib/server/integrations/obsidian.live.test.ts.
#
#   scripts/obsidian-dev.sh [VAULT_DIR]     start (default: a fresh copy of scripts/sample-vault)
#   scripts/obsidian-dev.sh stop            remove the container
#
# MCP URL: http://127.0.0.1:27123/mcp/ (HTTPS with a self-signed cert on 27124). Key: testkey123,
# or $OBSIDIAN_DEV_KEY. Container name: $OBSIDIAN_DEV_NAME (default index-01-obsidian-dev).
set -euo pipefail

name=${OBSIDIAN_DEV_NAME:-index-01-obsidian-dev}
image=${OBSIDIAN_DEV_IMAGE:-ghcr.io/heracraft/obsidian-remote-rest-api:latest}
key=${OBSIDIAN_DEV_KEY:-testkey123}
http_port=${OBSIDIAN_DEV_HTTP_PORT:-27123}
https_port=${OBSIDIAN_DEV_HTTPS_PORT:-27124}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if [[ ${1:-} == stop ]]; then
	docker rm -f "$name" >/dev/null 2>&1 || true
	echo "Stopped $name"
	exit 0
fi

vault=${1:-}
if [[ -z $vault ]]; then
	vault=$(mktemp -d "${TMPDIR:-/tmp}/obsidian-vault-XXXXXX")
	cp -a "$here/sample-vault/." "$vault/"
fi
vault=$(cd "$vault" && pwd)

docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --user "$(id -u):$(id -g)" \
	-v "$vault:/vault" \
	--tmpfs /data:uid="$(id -u)",gid="$(id -g)" \
	-e API_KEY="$key" -e ENABLE_INSECURE_SERVER=true -e DATA_DIR=/data \
	-p "127.0.0.1:$http_port:27123" -p "127.0.0.1:$https_port:27124" \
	"$image" >/dev/null

for _ in $(seq 1 50); do
	if curl -fsS "http://127.0.0.1:$http_port/" >/dev/null 2>&1; then
		echo "Vault:   $vault"
		echo "MCP URL: http://127.0.0.1:$http_port/mcp/"
		echo "Key:     $key"
		exit 0
	fi
	sleep 0.2
done
echo "Server did not answer on port $http_port. Logs:" >&2
docker logs "$name" >&2
exit 1
