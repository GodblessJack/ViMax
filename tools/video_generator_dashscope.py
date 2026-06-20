"""DashScope (阿里云百炼) Video Generator adapter for ViMax.

Uses Tongyi Wanxiang (通义万相) video generation API.
Endpoint: POST /api/v1/services/aigc/video-generation/video-synthesis
Models: wan2.7-i2v (latest, April 2026), wan2.6-i2v-flash (fast)

Usage::

    gen = VideoGeneratorDashScope(api_key="sk-...")
    output = await gen.generate_single_video(
        prompt="A cat running under moonlight",
        reference_image_paths=[],        # or ["first_frame.png"]
        duration=5,
        resolution="720p",
    )
    output.save("output.mp4")
"""

import asyncio
import logging
import os
import tempfile
from typing import List, Optional

import aiohttp

from interfaces.video_output import VideoOutput
from utils.image import image_path_to_b64
from utils.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Endpoints
SYNTHESIS_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
TASKS_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/tasks"

# Model constants
T2V_MODEL = "wan2.5-t2v-preview"     # Text-to-video (fast + audio support)
I2V_MODEL = "wan2.5-i2v-preview"     # Image-to-video (first frame)
FF2V_MODEL = "wan2.5-i2v-preview"    # First-frame-to-video
FLF2V_MODEL = "wan2.5-i2v-preview"   # First-and-last-frame-to-video (same model)

# Polling
POLL_INTERVAL = 5  # seconds — video takes longer
MAX_POLL_ATTEMPTS = 120  # 10 minutes max


class VideoGeneratorDashScope:
    """DashScope Tongyi Wanxiang video generator.

    Implements the VideoGenerator protocol for ViMax compatibility.
    Supports text-to-video (no reference images) and first-frame-to-video
    (one reference image as the starting frame).
    """

    def __init__(
        self,
        api_key: str = "",
        t2v_model: str = T2V_MODEL,
        ff2v_model: str = FF2V_MODEL,
        flf2v_model: str = FLF2V_MODEL,
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.api_key = api_key or os.environ.get("DASHSCOPE_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "DashScope video generator requires an API key. "
                "Set DASHSCOPE_API_KEY environment variable or pass api_key directly."
            )
        self.t2v_model = t2v_model
        self.ff2v_model = ff2v_model
        self.flf2v_model = flf2v_model
        self.rate_limiter = rate_limiter
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

    async def _submit_task(self, payload: dict) -> str:
        """Submit video generation task, return task_id.

        Retries up to 3 times on throttling (rate-limit) errors with
        exponential backoff + jitter.  Non-throttling errors (auth,
        invalid params) raise immediately.
        """
        session = await self._get_session()
        last_error = None
        for attempt in range(3):
            async with session.post(
                SYNTHESIS_ENDPOINT, json=payload, headers=self._headers()
            ) as resp:
                data = await resp.json()
            if resp.status < 400 and not data.get("code"):
                break
            code = data.get("code", "UNKNOWN")
            msg = data.get("message", str(data))
            if "Throttling" in str(code) or "Rate" in str(code):
                last_error = RuntimeError(f"DashScope video rate limited: {code} - {msg}")
                if attempt < 2:
                    wait = (2 ** attempt) * 15 + (hash(str(payload)) % 5)  # 15s, 30s, 60s ± jitter
                    logger.warning(
                        "DashScope video rate limited (attempt %d/3), waiting %ds...",
                        attempt + 1, wait)
                    await asyncio.sleep(wait)
            else:
                raise RuntimeError(f"DashScope video error: {code} - {msg}")
        else:
            raise last_error  # type: ignore[misc]

        task_id = data.get("output", {}).get("task_id")
        if not task_id:
            raise RuntimeError(f"DashScope video: no task_id in response: {data}")
        logger.info("DashScope video task submitted: %s", task_id)
        return task_id

    async def _poll_task(self, task_id: str) -> dict:
        """Poll task status until SUCCEEDED."""
        session = await self._get_session()
        headers = {"Authorization": f"Bearer {self.api_key}"}
        url = f"{TASKS_ENDPOINT}/{task_id}"
        for i in range(MAX_POLL_ATTEMPTS):
            await asyncio.sleep(POLL_INTERVAL)
            async with session.get(url, headers=headers) as resp:
                data = await resp.json()
            status = data.get("output", {}).get("task_status")
            if i % 6 == 0:  # Log every 30s
                logger.info("DashScope video poll %d: %s", i + 1, status)
            if status == "SUCCEEDED":
                return data
            elif status == "FAILED":
                raise RuntimeError(f"DashScope video task failed: {data}")
        raise TimeoutError(
            f"DashScope video task {task_id} timed out after {MAX_POLL_ATTEMPTS} polls"
        )

    async def generate_single_video(
        self,
        prompt: str,
        reference_image_paths: List[str] = None,
        resolution: str = "720p",
        aspect_ratio: str = "16:9",
        duration: int = 5,
        **kwargs,
    ) -> VideoOutput:
        """Generate a single video from a text prompt and optional first/last frames.

        Args:
            prompt: Text description of the desired video content.
            reference_image_paths: Optional reference images.
                - Empty / 0 images: text-to-video mode.
                - 1 image: first-frame-to-video mode.
                - 2+ images: first-and-last-frame-to-video (uses first + last).
            resolution: "480p", "720p", or "1080p".
            aspect_ratio: "16:9" or "9:16".
            duration: Video duration in seconds (5 or 10 for most models).
            **kwargs: Additional args (ignored).

        Returns:
            VideoOutput with the generated video URL.
        """
        if self.rate_limiter:
            await asyncio.to_thread(self.rate_limiter.acquire)

        reference_image_paths = reference_image_paths or []

        # Map resolution to DashScope size format
        res_map = {
            "480p": "864*480",
            "720p": "1280*720",
            "1080p": "1920*1080",
        }
        size = res_map.get(resolution, "1280*720")

        # Determine mode: t2v, ff2v, or flf2v
        num_refs = len(reference_image_paths)

        if num_refs == 0:
            # Pure text-to-video
            model = self.t2v_model
            payload = {
                "model": model,
                "input": {"prompt": prompt},
                "parameters": {
                    "size": size,
                    "duration": duration,
                    "prompt_extend": True,
                },
            }
        else:
            # Image-to-video: DashScope i2v API uses "img_url" for the first frame.
            # When 2+ images are provided, use the first as img_url; the last frame
            # is described in the prompt for best results.
            model = self.ff2v_model
            img_url = self._upload_or_encode(reference_image_paths[0])
            input_data = {
                "prompt": prompt,
                "img_url": img_url,
            }
            # If last frame available, add it (wan2.5 supports last_frame_url)
            if num_refs >= 2:
                last_url = self._upload_or_encode(reference_image_paths[-1])
                input_data["last_frame_url"] = last_url
            payload = {
                "model": model,
                "input": input_data,
                "parameters": {
                    "size": size,
                    "duration": duration,
                    "prompt_extend": True,
                },
            }

        task_id = await self._submit_task(payload)
        result = await self._poll_task(task_id)

        # Extract video URL
        video_url = result.get("output", {}).get("video_url")
        if not video_url:
            # Try results array
            results = result.get("output", {}).get("results", [])
            if results:
                video_url = results[0].get("video_url") or results[0].get("url")
        if not video_url:
            raise RuntimeError(f"DashScope video: no video_url in output: {result}")

        return VideoOutput(fmt="url", ext="mp4", data=video_url)

    def _upload_or_encode(self, image_path: str) -> str:
        """Return image as a URL or data URI for the DashScope API.

        DashScope accepts HTTPS URLs or OSS URLs for img_url.
        For local files we use base64 data URIs as fallback.
        """
        if image_path.startswith(("http://", "https://")):
            return image_path
        # Use base64 data URI for local files
        return image_path_to_b64(image_path, mime=True)

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
