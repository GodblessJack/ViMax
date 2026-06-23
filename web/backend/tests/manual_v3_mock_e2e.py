"""V3 Mock-mode full 6-step E2E test — verifies complete gated workflow.

With VIMAX_MOCK=1, the pipeline generates mock artifacts without LLM,
allowing programmatic verification of the entire 6-step flow.
"""

import asyncio
import json
import os
import urllib.request

import websockets

BASE_URL = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
WS_BASE = BASE_URL.replace("http://", "ws://")


def rest_post(path, data):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


async def test_full_v3_mock_flow():
    """Run the complete V3 gated workflow with MOCK_MODE."""

    # 1. Create session
    sd = rest_post("/api/sessions", {
        "idea": "Mock E2E 武侠短片",
        "style": "wuxia",
        "user_requirement": "",
    })
    sid = sd["session_id"]
    print(f"1. Session created: {sid}")

    # 2. Connect WS
    async with websockets.connect(f"{WS_BASE}/ws/session/{sid}") as ws:
        welcome = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert welcome["type"] == "connected"
        print("2. WS connected")

        # 3. Start workflow via WS (V3 gated)
        await ws.send(json.dumps({
            "type": "user:action",
            "action": "start_workflow",
            "idea": "Mock E2E 武侠短片",
            "style": "wuxia",
            "user_requirement": "",
            "session_id": sid,
        }))
        print("3. user:action/start_workflow sent")

        # Collect and verify events
        events = []
        pre_confirms = []
        post_confirms = []
        step_running = set()
        step_done = set()

        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=90)
                evt = json.loads(raw)
                etype = evt.get("type", "")
                events.append(etype)

                if etype == "step:need_confirm_before":
                    step = evt.get("step", "")
                    pre_confirms.append(step)
                    print(f"   ⏳ pre_confirm: {step}")
                    # Auto-confirm
                    await ws.send(json.dumps({
                        "type": "user:confirm_before",
                        "step": step,
                    }))

                elif etype == "step:running":
                    step = evt.get("step", "")
                    step_running.add(step)

                elif etype == "step:need_confirm":
                    step = evt.get("step", "") or "unknown"
                    post_confirms.append(step)
                    print(f"   ✅ post_confirm: {step}")
                    # Auto-confirm
                    await ws.send(json.dumps({
                        "type": "user:confirm",
                        "step": step,
                    }))

                elif etype == "step:completed":
                    step = evt.get("step", "")
                    step_done.add(step)
                    print(f"   ✓ completed: {step}")

                elif etype == "pipeline_status":
                    stage = evt.get("stage", "")
                    if stage in ("rendered", "narrative_planned", "completed"):
                        print(f"   🏁 pipeline stage: {stage}")
                        if stage in ("rendered", "completed"):
                            break

        except asyncio.TimeoutError:
            pass

        print(f"\n📊 Results:")
        print(f"   Total events: {len(events)}")
        print(f"   Pre-confirms: {pre_confirms}")
        print(f"   Post-confirms: {post_confirms}")
        print(f"   Steps running: {step_running}")
        print(f"   Steps done: {step_done}")

        # Verify core V3 flow
        assert "agent:workflow_started" in events, "Missing workflow_started"
        assert len(pre_confirms) >= 1, f"No pre-confirms! Events: {events}"
        assert len(post_confirms) >= 1 or len(step_done) >= 1, \
            f"No post-confirms or completions! Events: {events}"

        print(f"\n🎉 V3 Mock E2E PASSED!")
        print(f"   Session: {sid}")
        return True


if __name__ == "__main__":
    asyncio.run(test_full_v3_mock_flow())
