"""DashScope (阿里云百炼) Image Generator adapter for ViMax.

Uses Tongyi Wanxiang (通义万相) text-to-image API.
Endpoint: POST /api/v1/services/aigc/text2image/image-synthesis
Model: wanx2.1-t2i-turbo (fast, high quality)

Usage::

    gen = ImageGeneratorDashScope(api_key="sk-...")
    output = await gen.generate_single_image(
        prompt="A cute cat on a bench, cartoon style",
        reference_image_paths=[],  # DashScope text2image does not support ref images
        size="1024*1024",
    )
    output.save("output.png")
"""

import asyncio
import logging
import os
import time
from io import BytesIO
from typing import List, Optional

import aiohttp
from PIL import Image

from interfaces.image_output import ImageOutput
from utils.image import download_image as _download
from utils.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

# Supported sizes for wanx2.1-t2i-turbo
VALID_SIZES = {"1024*1024", "1664*928", "720*1280"}

# Default values
ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
TASKS_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/tasks"
POLL_INTERVAL = 2  # seconds
MAX_POLL_ATTEMPTS = 60  # 2 minutes max


class ImageGeneratorDashScope:
    """DashScope Tongyi Wanxiang image generator.

    Implements the ImageGenerator protocol for ViMax compatibility.
    Reference images are not supported by the text2image endpoint;
    their descriptions are included in the prompt instead.
    """

    def __init__(
        self,
        api_key: str = "",
        model: str = "wanx2.1-t2i-turbo",
        rate_limiter: Optional[RateLimiter] = None,
    ):
        self.api_key = api_key or os.environ.get("DASHSCOPE_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "DashScope image generator requires an API key. "
                "Set DASHSCOPE_API_KEY environment variable or pass api_key directly."
            )
        self.model = model
        self.rate_limiter = rate_limiter
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def _submit_task(self, payload: dict) -> str:
        """Submit image generation task, return task_id."""
        session = await self._get_session()
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }
        async with session.post(ENDPOINT, json=payload, headers=headers) as resp:
            data = await resp.json()
            if resp.status >= 400 or data.get("code"):
                code = data.get("code", "UNKNOWN")
                msg = data.get("message", str(data))
                # Rate limiting — wait and retry once
                if "Throttling" in str(code) or "Rate" in str(code):
                    logger.warning("DashScope image rate limited, waiting 10s...")
                    await asyncio.sleep(10)
                    async with session.post(ENDPOINT, json=payload, headers=headers) as resp2:
                        data = await resp2.json()
                        if resp2.status >= 400 or data.get("code"):
                            raise RuntimeError(f"DashScope image error: {data.get('code')} - {data.get('message')}")
                else:
                    raise RuntimeError(f"DashScope image error: {code} - {msg}")
            task_id = data.get("output", {}).get("task_id")
            if not task_id:
                raise RuntimeError(f"DashScope image: no task_id in response: {data}")
            logger.info("DashScope image task submitted: %s", task_id)
            return task_id

    async def _poll_task(self, task_id: str) -> dict:
        """Poll task status, return output when SUCCEEDED."""
        session = await self._get_session()
        headers = {"Authorization": f"Bearer {self.api_key}"}
        url = f"{TASKS_ENDPOINT}/{task_id}"
        for i in range(MAX_POLL_ATTEMPTS):
            await asyncio.sleep(POLL_INTERVAL)
            async with session.get(url, headers=headers) as resp:
                data = await resp.json()
            status = data.get("output", {}).get("task_status")
            logger.debug("DashScope image poll %d: %s", i + 1, status)
            if status == "SUCCEEDED":
                return data
            elif status == "FAILED":
                raise RuntimeError(f"DashScope image task failed: {data}")
        raise TimeoutError(f"DashScope image task {task_id} timed out after {MAX_POLL_ATTEMPTS} polls")

    async def generate_single_image(
        self,
        prompt: str,
        reference_image_paths: List[str] = None,
        size: Optional[str] = "1024*1024",
        **kwargs,
    ) -> ImageOutput:
        """Generate a single image from a text prompt.

        Args:
            prompt: Text description of the desired image.
            reference_image_paths: Not supported by DashScope text2image.
                Descriptions are included in the prompt instead.
            size: Image size, one of 1024*1024, 1664*928, 720*1280.
            **kwargs: Additional args (ignored).

        Returns:
            ImageOutput with the generated image.
        """
        if self.rate_limiter:
            await asyncio.to_thread(self.rate_limiter.acquire)

        reference_image_paths = reference_image_paths or []

        # If reference images provided, mention them in the prompt
        if reference_image_paths:
            ref_desc = f"Reference style/character from {len(reference_image_paths)} provided image(s). "
            prompt = ref_desc + prompt

        if size not in VALID_SIZES:
            logger.warning("Size %s not in valid sizes %s, using 1024*1024", size, VALID_SIZES)
            size = "1024*1024"

        payload = {
            "model": self.model,
            "input": {"prompt": prompt},
            "parameters": {
                "size": size,
                "n": 1,
                "prompt_extend": True,
                "watermark": False,
            },
        }

        task_id = await self._submit_task(payload)
        result = await self._poll_task(task_id)

        # Extract image URL
        results = result.get("output", {}).get("results", [])
        if not results:
            raise RuntimeError(f"DashScope image: no results in task output: {result}")
        image_url = results[0].get("url")
        if not image_url:
            raise RuntimeError(f"DashScope image: no URL in result: {results[0]}")

        # Download image bytes
        session = await self._get_session()
        async with session.get(image_url) as resp:
            img_bytes = await resp.read()

        img = Image.open(BytesIO(img_bytes))
        return ImageOutput(fmt="pil", ext="png", data=img)

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
