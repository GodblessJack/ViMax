"""V3 WebSocket E2E test — programmatic verification of the gated workflow.

Tests the V3 flow without a browser. Validates:
1. Session creation (REST 201)
2. WebSocket connection + welcome event
3. user:action/start_workflow → agent:workflow_started
4. step:need_confirm_before (depends on LLM tool call — may timeout in CI)
5. user:confirm_before → agent:confirm_ack
"""

import asyncio
import json
import os
import sys
import urllib.request

import websockets
import pytest

BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
WS_BASE = BASE_URL.replace("http://", "ws://")


def _rest_post(path: str, data: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.mark.asyncio
async def test_v3_session_creation():
    """Step 1: Create session via REST."""
    data = _rest_post("/api/sessions", {
        "idea": "V3 E2E test 武侠短片",
        "style": "wuxia",
        "user_requirement": "",
    })
    assert "session_id" in data
    assert data["stage"] == "created"


@pytest.mark.asyncio
async def test_v3_ws_connect_and_start_workflow():
    """Step 2-3: Connect WS, send user:action/start_workflow."""
    session_data = _rest_post("/api/sessions", {
        "idea": "V3 WS test",
        "style": "wuxia",
        "user_requirement": "",
    })
    session_id = session_data["session_id"]

    ws_url = f"{WS_BASE}/ws/session/{session_id}"
    try:
        async with websockets.connect(ws_url) as ws:
            # 1. Welcome event
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            evt = json.loads(raw)
            assert evt.get("type") == "connected"

            # 2. Send user:action/start_workflow
            await ws.send(json.dumps({
                "type": "user:action",
                "action": "start_workflow",
                "idea": "V3 WS test",
                "style": "wuxia",
                "user_requirement": "",
                "session_id": session_id,
            }))

            # 3. Expect agent:workflow_started
            raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
            evt = json.loads(raw)
            assert evt.get("type") == "agent:workflow_started", \
                f"Expected agent:workflow_started, got: {evt.get('type')}"

            # 4. Try to receive step:need_confirm_before (LLM-dependent)
            #    Collect all events for 30s to see what the agent produces
            events = []
            try:
                while True:
                    raw = await asyncio.wait_for(ws.recv(), timeout=45.0)
                    evt = json.loads(raw)
                    events.append(evt.get("type"))
                    if evt.get("type") == "step:need_confirm_before":
                        # Found pre-confirmation gate!
                        step_name = evt.get("step", "")
                        print(f"  ✅ step:need_confirm_before (step={step_name})")
                        await ws.send(json.dumps({
                            "type": "user:confirm_before",
                            "step": step_name,
                        }))
                        # After confirm_before, the gate resumes and step
                        # execution begins. Events may arrive in any order:
                        # pipeline:status, step:running, agent:confirm_ack.
                        # Any of these prove the gate unlocked successfully.
                        gate_unlocked = False
                        for _ in range(5):
                            ack_raw = await asyncio.wait_for(ws.recv(), timeout=15.0)
                            ack = json.loads(ack_raw)
                            events.append(ack.get("type"))
                            print(f"  Post-confirm event: {ack.get('type')}")
                            if ack.get("type") in (
                                "agent:confirm_ack",     # ws.py response
                                "pipeline:status",       # step execution started
                                "step:running",          # step running broadcast
                                "step:completed",        # step finished
                            ):
                                gate_unlocked = True
                                break
                        assert gate_unlocked, \
                            f"Gate did not unlock after confirm_before. Events: {events}"
                        break
            except asyncio.TimeoutError:
                pass  # LLM may not be available in CI

            print(f"  V3 WS flow: session={session_id}")
            print(f"  Events received: {events}")

            # Minimum verification: the WS flow starts correctly
            assert "agent:workflow_started" in events

    except websockets.exceptions.InvalidStatus:
        pytest.skip("WebSocket unavailable")


if __name__ == "__main__":
    asyncio.run(test_v3_ws_connect_and_start_workflow())
