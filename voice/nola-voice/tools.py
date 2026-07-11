"""
NOLA tool implementations — direct API calls.
Ported from vapi-tool-handler.js; returns plain English strings for TTS.
"""

import socket
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests


# ── Parse NETDATA_HOSTS env var ───────────────────────────────────────────────

def parse_netdata_hosts(env_val: str) -> dict:
    """'name1:http://ip:port,name2:http://ip:port' → {'name1': 'http://...'}"""
    result = {}
    for entry in (env_val or '').split(','):
        entry = entry.strip()
        idx = entry.find(':http')
        if idx > 0:
            name = entry[:idx].strip().lower()
            url = entry[idx + 1:].strip().rstrip('/')
            result[name] = url
    return result


# ── UPS (NUT protocol on port 3551) ──────────────────────────────────────────

def get_ups_status(host: str, port: int = 3551) -> str:
    if not host:
        return 'UPS host not configured.'
    try:
        with socket.create_connection((host, port), timeout=5) as sock:
            cmd = b'status'
            sock.sendall(len(cmd).to_bytes(2, 'big') + cmd)

            rx = b''
            text = ''
            while True:
                data = sock.recv(4096)
                if not data:
                    break
                rx += data
                while len(rx) >= 2:
                    length = int.from_bytes(rx[:2], 'big')
                    if length == 0:
                        rx = b''
                        break
                    if len(rx) < 2 + length:
                        break
                    text += rx[2:2 + length].decode('utf-8', errors='ignore')
                    rx = rx[2 + length:]
                if not rx:
                    break

        kv: dict = {}
        for line in text.split('\n'):
            if ':' in line:
                k, _, v = line.partition(':')
                kv[k.strip()] = v.strip()

        name    = kv.get('UPSNAME', 'UPS')
        status  = kv.get('STATUS', 'UNKNOWN')
        battery = float(kv.get('BCHARGE') or 0)
        load    = float(kv.get('LOADPCT') or 0)
        runtime = float(kv.get('TIMELEFT') or 0)
        voltage = float(kv.get('LINEV') or 0)

        return (f"{name}: {status}. Battery {battery:.0f} percent. "
                f"Load {load:.0f} percent. Runtime {runtime:.0f} minutes. "
                f"Line voltage {voltage:.0f} volts.")
    except Exception as e:
        return f'UPS error: {e}'


# ── Netdata metrics ───────────────────────────────────────────────────────────

def _parse_netdata_chart(data: dict) -> dict:
    """Extract label→value dict from a Netdata /api/v1/data response."""
    if not data or not data.get('data'):
        return {}
    labels = data['labels'][1:]
    vals = data['data'][0][1:]
    return dict(zip(labels, vals))


def get_netdata_metrics(host: str, host_map: dict) -> str:
    key = host.lower().strip()
    base_url = host_map.get(key)
    if not base_url and host_map:
        base_url = next(iter(host_map.values()))
    if not base_url:
        return 'No Netdata hosts configured.'

    urls = {
        'cpu':    f'{base_url}/api/v1/data?chart=system.cpu&after=-60&points=1&format=json',
        'ram':    f'{base_url}/api/v1/data?chart=system.ram&after=-60&points=1&format=json',
        'uptime': f'{base_url}/api/v1/data?chart=system.uptime&after=-60&points=1&format=json',
    }

    try:
        results = {}
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(requests.get, url, timeout=8): key for key, url in urls.items()}
            for fut in as_completed(futures):
                k = futures[fut]
                results[k] = fut.result().json()

        cpu_dims = _parse_netdata_chart(results['cpu'])
        cpu_pct = sum(abs(v or 0) for v in cpu_dims.values())

        ram_dims = _parse_netdata_chart(results['ram'])
        ram_used = abs(ram_dims.get('used') or ram_dims.get('active') or 0)
        ram_total = sum(abs(v or 0) for v in ram_dims.values())
        ram_pct = (ram_used / ram_total * 100) if ram_total > 0 else 0

        uptime_dims = _parse_netdata_chart(results['uptime'])
        uptime_sec = next(iter(uptime_dims.values()), 0) or 0
        uptime_hours = uptime_sec / 3600

        return (f"{host}: CPU {cpu_pct:.1f} percent. "
                f"RAM {ram_pct:.1f} percent used. "
                f"Uptime {uptime_hours:.1f} hours.")
    except Exception as e:
        return f'Netdata error for {host}: {e}'


# ── Prometheus ────────────────────────────────────────────────────────────────

def query_prometheus(query: str, prometheus_url: str) -> str:
    if not prometheus_url:
        return 'Prometheus URL not configured.'
    try:
        r = requests.get(
            f'{prometheus_url}/api/v1/query',
            params={'query': query or 'up'},
            timeout=8,
        )
        data = r.json()
        result = data.get('data', {}).get('result', [])
        if not result:
            return f'No results for: {query}'
        parts = []
        for item in result[:6]:
            metric = item.get('metric', {})
            instance = metric.get('instance') or metric.get('job') or 'unknown'
            val = item.get('value', [None, '?'])[1]
            parts.append(f'{instance}: {val}')
        return '. '.join(parts)
    except Exception as e:
        return f'Prometheus error: {e}'


# ── Run command (via n8n sub-webhook) ────────────────────────────────────────

def run_command(host: str, command: str, n8n_base_url: str) -> str:
    if not n8n_base_url:
        return 'n8n webhook URL not configured. Set N8N_WEBHOOK_BASE_URL.'
    try:
        r = requests.post(
            f'{n8n_base_url}/webhook/nola-run-command',
            json={'host': host, 'command': command},
            timeout=20,
        )
        data = r.json()
        return (data.get('output') or data.get('stdout') or data.get('result') or
                (f"Error: {data['error']}" if 'error' in data else str(data)[:200]))
    except Exception as e:
        return f'Run command error: {e}'
