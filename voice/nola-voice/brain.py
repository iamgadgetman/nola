"""
OpenAI GPT brain with function calling.
Maintains a short conversation window for context between turns.
"""

import json
import openai
from tools import (
    get_ups_status,
    get_netdata_metrics,
    query_prometheus,
    run_command,
    parse_netdata_hosts,
)

SYSTEM_PROMPT = """\
You are NOLA, an AI assistant managing a homelab. You are accessed by voice.

Rules:
- Respond in plain speech only. No markdown, no bullet points, no asterisks, no lists.
- Keep responses concise — you are speaking, not writing.
- Spell out numbers naturally: "eighty-five percent" not "85%".
- Use a warm, direct tone. You are knowledgeable and efficient.
- Do not announce when you are using tools. Just use them and report the result.
- If something is broken or misconfigured, say so plainly.\
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_ups_status",
            "description": "Get UPS battery level, load, runtime remaining, and power status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_netdata_metrics",
            "description": "Get CPU usage, RAM usage, and uptime for a specific host.",
            "parameters": {
                "type": "object",
                "properties": {
                    "host": {"type": "string", "description": "Host name, e.g. containy, knox, dilithium"}
                },
                "required": ["host"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_prometheus",
            "description": "Run a PromQL query against Prometheus to get metrics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "PromQL expression, e.g. up or node_load1"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a shell command on an allowed host via SSH.",
            "parameters": {
                "type": "object",
                "properties": {
                    "host": {"type": "string", "description": "Target host label"},
                    "command": {"type": "string", "description": "Shell command to run"},
                },
                "required": ["host", "command"],
            },
        },
    },
]

MAX_TURNS = 6


class Brain:
    def __init__(self, config):
        self._client = openai.OpenAI(api_key=config.OPENAI_API_KEY)
        self._config = config
        self._history: list = []
        self._netdata_hosts = parse_netdata_hosts(config.NETDATA_HOSTS)

    def _dispatch_tool(self, name: str, inputs: dict) -> str:
        cfg = self._config
        if name == 'get_ups_status':
            return get_ups_status(cfg.UPS_HOST, cfg.UPS_PORT)
        if name == 'get_netdata_metrics':
            return get_netdata_metrics(inputs.get('host', ''), self._netdata_hosts)
        if name == 'query_prometheus':
            return query_prometheus(inputs.get('query', 'up'), cfg.PROMETHEUS_URL)
        if name == 'run_command':
            return run_command(inputs.get('host', ''), inputs.get('command', ''), cfg.N8N_WEBHOOK_BASE_URL)
        return f'Unknown tool: {name}'

    def respond(self, user_text: str) -> str:
        self._history.append({"role": "user", "content": user_text})

        if len(self._history) > MAX_TURNS * 2:
            self._history = self._history[-(MAX_TURNS * 2):]

        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + list(self._history)

        while True:
            response = self._client.chat.completions.create(
                model=self._config.OPENAI_MODEL,
                max_tokens=512,
                tools=TOOLS,
                messages=messages,
            )

            choice = response.choices[0]

            if choice.finish_reason == 'tool_calls':
                messages.append(choice.message)
                for tc in choice.message.tool_calls:
                    inputs = json.loads(tc.function.arguments)
                    result = self._dispatch_tool(tc.function.name, inputs)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })
                continue

            text = (choice.message.content or '').strip()
            self._history.append({"role": "assistant", "content": text})
            return text

    def clear_history(self):
        self._history.clear()
