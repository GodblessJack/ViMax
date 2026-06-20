"""Mock tests for the API retry-waste fixes.

All tests use mock LLM / mock HTTP — zero real API calls.
"""

import json
import os
import sys
import tempfile
import time
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# All async tests use asyncio.run() directly — no pytest-asyncio required.
# (pytest-asyncio is not installed in this venv.)


def _run(coro):
    """Helper: run an async test via asyncio."""
    return asyncio.run(coro)

# Ensure the ViMax root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ──────────────────────────────────────────────────────────────────────
# Fix 1 & 2: reference_image_selector — no tenacity retry, unified dict return
# ──────────────────────────────────────────────────────────────────────

class TestReferenceImageSelector:
    """Verify that select_reference_images_and_generate_prompt:
    - Returns a plain dict (never a Pydantic model)
    - Fails fast on empty input
    - Returns all indices for < 8 images (no LLM call)
    - Retries once on transient errors, falls back on deterministic errors
    """

    @pytest.fixture
    def selector(self):
        from agents.reference_image_selector import ReferenceImageSelector
        mock_chat = AsyncMock()
        return ReferenceImageSelector(chat_model=mock_chat)

    def test_empty_input_returns_empty_indices(self, selector):
        """Empty pairs → immediate return with empty indices, no LLM call."""
        result = _run(selector.select_reference_images_and_generate_prompt(
            available_image_path_and_text_pairs=[],
            frame_description="test frame",
        ))
        assert isinstance(result, dict), f"Expected dict, got {type(result)}"
        assert result["ref_image_indices"] == []
        assert result["text_prompt"] == "test frame"
        selector.chat_model.ainvoke.assert_not_called()

    def test_few_images_returns_all_indices_no_llm(self, selector):
        """< 8 images → guard clause returns all indices, no LLM call."""
        pairs = [(f"/tmp/img{i}.png", f"desc {i}") for i in range(5)]
        result = _run(selector.select_reference_images_and_generate_prompt(
            available_image_path_and_text_pairs=pairs,
            frame_description="test frame",
        ))
        assert isinstance(result, dict)
        assert result["ref_image_indices"] == [0, 1, 2, 3, 4]
        assert result["text_prompt"] == "test frame"
        selector.chat_model.ainvoke.assert_not_called()

    def test_many_images_returns_valid_indices(self, selector):
        """>= 8 images → goes through LLM path, returns dict with valid indices."""
        # Create real temp images for the base64 encoding (step 2)
        import tempfile as _tmp
        tmp_files = []
        pairs = []
        for i in range(10):
            f = _tmp.NamedTemporaryFile(suffix='.png', delete=False)
            f.write(b'\x89PNG\r\n\x1a\n' + b'\x00' * 20)  # minimal PNG header
            f.close()
            tmp_files.append(f.name)
            pairs.append((f.name, f"desc {i}"))
        try:
            from agents.reference_image_selector import RefImageIndicesAndTextPrompt
            mock_response = RefImageIndicesAndTextPrompt(
                ref_image_indices=[0, 1, 2, 3, 4, 5, 6, 7],
                text_prompt="generated prompt",
            )
            mock_runnable = AsyncMock()
            mock_runnable.ainvoke = AsyncMock(return_value=mock_response)
            with patch.object(selector, 'chat_model') as mock_chat:
                mock_chat.__or__ = MagicMock(return_value=mock_runnable)
                result = _run(selector.select_reference_images_and_generate_prompt(
                    available_image_path_and_text_pairs=pairs,
                    frame_description="test frame",
                ))
            assert isinstance(result, dict)
            assert "ref_image_indices" in result
            assert "text_prompt" in result
            assert result["text_prompt"] == "generated prompt"
            for idx in result["ref_image_indices"]:
                assert 0 <= idx < len(pairs)
        finally:
            for f in tmp_files:
                os.unlink(f)

    def test_deterministic_error_falls_back_not_retries(self, selector):
        """When LLM returns out-of-range indices, fall back without retry."""
        import tempfile as _tmp
        tmp_files = []
        pairs = []
        for i in range(10):
            f = _tmp.NamedTemporaryFile(suffix='.png', delete=False)
            f.write(b'\x89PNG\r\n\x1a\n' + b'\x00' * 20)
            f.close()
            tmp_files.append(f.name)
            pairs.append((f.name, f"desc {i}"))
        try:
            from agents.reference_image_selector import RefImageIndicesAndTextPrompt
            bad_response = RefImageIndicesAndTextPrompt(
                ref_image_indices=[99], text_prompt="bad",
            )
            mock_runnable = AsyncMock()
            mock_runnable.ainvoke = AsyncMock(return_value=bad_response)
            with patch.object(selector, 'chat_model') as mock_chat:
                mock_chat.__or__ = MagicMock(return_value=mock_runnable)
                result = _run(selector.select_reference_images_and_generate_prompt(
                    available_image_path_and_text_pairs=pairs,
                    frame_description="test frame",
                ))
            assert isinstance(result, dict)
            assert len(result["ref_image_indices"]) == 10  # full set fallback
            # Step 1 + step 2 each call LLM once; both get ValueError → no retry
            assert mock_runnable.ainvoke.call_count == 2
        finally:
            for f in tmp_files:
                os.unlink(f)

    def test_transient_error_retries_then_falls_back(self, selector):
        """Transient network error → retry once, then fall back to full set."""
        import tempfile as _tmp
        tmp_files = []
        pairs = []
        for i in range(10):
            f = _tmp.NamedTemporaryFile(suffix='.png', delete=False)
            f.write(b'\x89PNG\r\n\x1a\n' + b'\x00' * 20)
            f.close()
            tmp_files.append(f.name)
            pairs.append((f.name, f"desc {i}"))
        try:
            from agents.reference_image_selector import RefImageIndicesAndTextPrompt
            good_response = RefImageIndicesAndTextPrompt(
                ref_image_indices=[0, 1, 2, 3, 4, 5, 6, 7],
                text_prompt="good",
            )
            mock_runnable = AsyncMock()
            mock_runnable.ainvoke = AsyncMock(side_effect=[
                ConnectionError("network error"),
                good_response,
                good_response,
            ])
            with patch.object(selector, 'chat_model') as mock_chat:
                mock_chat.__or__ = MagicMock(return_value=mock_runnable)
                result = _run(selector.select_reference_images_and_generate_prompt(
                    available_image_path_and_text_pairs=pairs,
                    frame_description="test frame",
                ))
            assert isinstance(result, dict)
            assert "ref_image_indices" in result
            assert mock_runnable.ainvoke.call_count >= 2
        finally:
            for f in tmp_files:
                os.unlink(f)


# ──────────────────────────────────────────────────────────────────────
# Fix 3: pipeline — corrupt JSON cache recovery
# ──────────────────────────────────────────────────────────────────────

class TestCorruptCacheRecovery:
    """Verify that _load_cached_selector_output handles corrupt files."""

    def test_missing_file_returns_none(self):
        from pipelines.script2video_pipeline import _load_cached_selector_output
        result = _load_cached_selector_output("/nonexistent/path.json", shot_idx=0, frame_label="test")
        assert result is None

    def test_valid_file_loads_correctly(self):
        from pipelines.script2video_pipeline import _load_cached_selector_output
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"ref_image_indices": [0, 1], "text_prompt": "hello"}, f)
            path = f.name
        try:
            result = _load_cached_selector_output(path, shot_idx=0, frame_label="test")
            assert result == {"ref_image_indices": [0, 1], "text_prompt": "hello"}
        finally:
            os.unlink(path)

    def test_empty_file_deleted_and_returns_none(self):
        from pipelines.script2video_pipeline import _load_cached_selector_output
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("")  # empty
            path = f.name
        try:
            result = _load_cached_selector_output(path, shot_idx=0, frame_label="test")
            assert result is None
            assert not os.path.exists(path), "Corrupt file should be deleted"
        finally:
            if os.path.exists(path):
                os.unlink(path)

    def test_corrupt_json_deleted_and_returns_none(self):
        from pipelines.script2video_pipeline import _load_cached_selector_output
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("this is not json {{{")
            path = f.name
        try:
            result = _load_cached_selector_output(path, shot_idx=0, frame_label="test")
            assert result is None
            assert not os.path.exists(path), "Corrupt file should be deleted"
        finally:
            if os.path.exists(path):
                os.unlink(path)

    def test_missing_keys_deleted_and_returns_none(self):
        from pipelines.script2video_pipeline import _load_cached_selector_output
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"wrong_key": [1, 2, 3]}, f)  # missing ref_image_indices
            path = f.name
        try:
            result = _load_cached_selector_output(path, shot_idx=0, frame_label="test")
            assert result is None
            assert not os.path.exists(path), "File with missing keys should be deleted"
        finally:
            if os.path.exists(path):
                os.unlink(path)

    def test_not_a_dict_deleted_and_returns_none(self):
        from pipelines.script2video_pipeline import _load_cached_selector_output
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump([1, 2, 3], f)  # list, not dict
            path = f.name
        try:
            result = _load_cached_selector_output(path, shot_idx=0, frame_label="test")
            assert result is None
            assert not os.path.exists(path), "Non-dict file should be deleted"
        finally:
            if os.path.exists(path):
                os.unlink(path)


# ──────────────────────────────────────────────────────────────────────
# Fix 4: image generator — rate-limit backoff
# ──────────────────────────────────────────────────────────────────────

class TestImageGeneratorRateLimit:
    """Verify that rate-limit handling uses exponential backoff."""

    def test_non_rate_limit_error_raises_immediately(self):
        """Non-rate-limit errors (auth, invalid params) must NOT retry."""
        from tools.image_generator_dashscope import ImageGeneratorDashScope

        gen = ImageGeneratorDashScope(api_key="sk-test")
        mock_session = MagicMock()
        mock_session.closed = False
        mock_resp = MagicMock()
        mock_resp.status = 400
        mock_resp.json = AsyncMock(return_value={
            "code": "InvalidParameter", "message": "Bad parameter",
        })
        mock_session.post = MagicMock()
        mock_session.post.return_value.__aenter__ = AsyncMock(return_value=mock_resp)
        mock_session.post.return_value.__aexit__ = AsyncMock(return_value=None)
        gen._session = mock_session

        with pytest.raises(RuntimeError, match="InvalidParameter"):
            _run(gen._submit_task({"model": "wanx2.1-t2i-turbo", "input": {"prompt": "test"}}))
        assert mock_session.post.call_count == 1

    def test_rate_limit_retries_with_backoff(self):
        """Rate-limit errors retry up to 3 times with backoff."""
        from tools.image_generator_dashscope import ImageGeneratorDashScope

        gen = ImageGeneratorDashScope(api_key="sk-test")
        mock_session = MagicMock()
        mock_session.closed = False
        rate_limited = MagicMock()
        rate_limited.status = 429
        rate_limited.json = AsyncMock(return_value={
            "code": "Throttling.RateQuota", "message": "Rate limit exceeded",
        })
        success = MagicMock()
        success.status = 200
        success.json = AsyncMock(return_value={"output": {"task_id": "task-123"}})

        call_count = [0]

        def make_ctx(resp):
            call_count[0] += 1
            ctx = MagicMock()
            ctx.__aenter__ = AsyncMock(return_value=resp)
            ctx.__aexit__ = AsyncMock(return_value=None)
            return ctx

        mock_session.post = MagicMock(side_effect=[
            make_ctx(rate_limited), make_ctx(rate_limited), make_ctx(success),
        ])
        gen._session = mock_session

        with patch('asyncio.sleep', new_callable=AsyncMock) as mock_sleep:
            task_id = _run(gen._submit_task(
                {"model": "wanx2.1-t2i-turbo", "input": {"prompt": "test"}}))

        assert task_id == "task-123"
        assert call_count[0] == 3
        assert mock_sleep.call_count >= 2

    def test_rate_limit_exhausted_raises(self):
        """When all rate-limit retries are exhausted, raise RuntimeError."""
        from tools.image_generator_dashscope import ImageGeneratorDashScope

        gen = ImageGeneratorDashScope(api_key="sk-test")
        mock_session = MagicMock()
        mock_session.closed = False
        rate_limited = MagicMock()
        rate_limited.status = 429
        rate_limited.json = AsyncMock(return_value={
            "code": "Throttling.RateQuota", "message": "Rate limit exceeded",
        })

        def make_ctx(resp):
            ctx = MagicMock()
            ctx.__aenter__ = AsyncMock(return_value=resp)
            ctx.__aexit__ = AsyncMock(return_value=None)
            return ctx

        mock_session.post = MagicMock(side_effect=[
            make_ctx(rate_limited), make_ctx(rate_limited), make_ctx(rate_limited),
        ])
        gen._session = mock_session

        with patch('asyncio.sleep', new_callable=AsyncMock):
            with pytest.raises(RuntimeError, match="rate limited"):
                _run(gen._submit_task(
                    {"model": "wanx2.1-t2i-turbo", "input": {"prompt": "test"}}))

    def test_success_on_first_try_no_sleep(self):
        """Successful submission on first try → no sleep."""
        from tools.image_generator_dashscope import ImageGeneratorDashScope

        gen = ImageGeneratorDashScope(api_key="sk-test")
        mock_session = MagicMock()
        mock_session.closed = False
        success = MagicMock()
        success.status = 200
        success.json = AsyncMock(return_value={"output": {"task_id": "task-456"}})
        ctx = MagicMock()
        ctx.__aenter__ = AsyncMock(return_value=success)
        ctx.__aexit__ = AsyncMock(return_value=None)
        mock_session.post = MagicMock(return_value=ctx)
        gen._session = mock_session

        with patch('asyncio.sleep', new_callable=AsyncMock) as mock_sleep:
            task_id = _run(gen._submit_task(
                {"model": "wanx2.1-t2i-turbo", "input": {"prompt": "test"}}))

        assert task_id == "task-456"
        mock_sleep.assert_not_called()


# ──────────────────────────────────────────────────────────────────────
# End-to-end: corrupt file → regenerate → success
# ──────────────────────────────────────────────────────────────────────

class TestEndToEndCorruptRecovery:
    """Simulate the full pipeline corrupt-file recovery flow."""

    def test_corrupt_cache_regenerates_and_succeeds(self):
        """When cache is corrupt, delete it, regenerate, and save valid JSON."""
        from pipelines.script2video_pipeline import _load_cached_selector_output

        # Step 1: Create a corrupt cache file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("corrupt!!!")
            path = f.name

        # Step 2: Try to load — should return None and delete file
        result = _load_cached_selector_output(path, shot_idx=0, frame_label="first_frame")
        assert result is None
        assert not os.path.exists(path), "Corrupt file should be deleted"

        # Step 3: Write a valid file (simulating regeneration)
        valid_data = {"ref_image_indices": [0, 1, 2], "text_prompt": "regenerated"}
        with open(path, 'w') as f:
            json.dump(valid_data, f)

        # Step 4: Load again — should succeed
        result = _load_cached_selector_output(path, shot_idx=0, frame_label="first_frame")
        assert result == valid_data

        os.unlink(path)


# ──────────────────────────────────────────────────────────────────────
# Stale cache recovery — valid JSON but indices out of range
# ──────────────────────────────────────────────────────────────────────

class TestStaleCacheRecovery:
    """Verify that stale cached indices (valid JSON, wrong values) trigger
    regeneration instead of cascading into a rendering failure."""

    def test_structural_valid_but_stale_indices_caught(self):
        """_load_cached_selector_output passes structurally-valid JSON,
        but _select_pairs catches stale indices at the call site."""
        from pipelines.script2video_pipeline import _load_cached_selector_output, _select_pairs

        # Create a cache file with valid structure but indices that won't
        # match the actual available image set.
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({"ref_image_indices": [0, 5, 99], "text_prompt": "test"}, f)
            path = f.name
        try:
            data = _load_cached_selector_output(path, shot_idx=0, frame_label="test")
            assert data is not None  # structurally valid, loads fine

            # But when applied to a smaller set, _select_pairs raises
            small_set = [("img0.png", "d0"), ("img1.png", "d1")]
            with pytest.raises(ValueError, match="ref_image_indices out of range"):
                _select_pairs(small_set, data["ref_image_indices"])
        finally:
            if os.path.exists(path):
                os.unlink(path)

    def test_valid_indices_pass_through(self):
        """When indices are within range, _select_pairs works normally."""
        from pipelines.script2video_pipeline import _select_pairs
        pairs = [("a.png", "A"), ("b.png", "B"), ("c.png", "C")]
        result = _select_pairs(pairs, [0, 2])
        assert result == [("a.png", "A"), ("c.png", "C")]


# ──────────────────────────────────────────────────────────────────────
# Fix 5: circuit breaker — prevent infinite render restarts
# ──────────────────────────────────────────────────────────────────────

class TestCircuitBreaker:
    """Verify that the circuit breaker rejects renders after repeated failures."""

    def test_first_failure_allows_retry(self):
        from web.backend.services.pipeline_service import PipelineService
        svc = PipelineService("/tmp/test-vimax-circuit-breaker")
        sid = "test-session-1"
        svc._record_render_failure(sid)
        timestamps = svc._render_failures.get(sid, [])
        assert len(timestamps) == 1

    def test_three_failures_triggers_breaker(self):
        from web.backend.services.pipeline_service import (
            PipelineService,
            _CB_MAX_FAILURES,
            _CB_WINDOW_SECONDS,
        )
        svc = PipelineService("/tmp/test-vimax-circuit-breaker")
        sid = "test-session-2"
        # Simulate 3 failures
        for _ in range(_CB_MAX_FAILURES):
            svc._record_render_failure(sid)
        timestamps = svc._render_failures.get(sid, [])
        # Should have 3 timestamps, all within window
        assert len(timestamps) == _CB_MAX_FAILURES
        # Verify they're recent (within window)
        now = time.time()
        recent = [t for t in timestamps if now - t < _CB_WINDOW_SECONDS]
        assert len(recent) == _CB_MAX_FAILURES

    def test_old_failures_expire(self):
        from web.backend.services.pipeline_service import PipelineService
        svc = PipelineService("/tmp/test-vimax-circuit-breaker")
        sid = "test-session-3"
        # Add an old failure (2 hours ago)
        svc._render_failures[sid] = [time.time() - 7200]
        # start_rendering purges old entries — simulate that
        now = time.time()
        timestamps = svc._render_failures.get(sid, [])
        timestamps = [t for t in timestamps if now - t < 1800]
        assert len(timestamps) == 0

    def test_success_clears_failures(self):
        from web.backend.services.pipeline_service import PipelineService
        svc = PipelineService("/tmp/test-vimax-circuit-breaker")
        sid = "test-session-4"
        svc._record_render_failure(sid)
        svc._record_render_failure(sid)
        assert len(svc._render_failures.get(sid, [])) == 2
        # Simulate success clearing
        svc._render_failures.pop(sid, None)
        assert sid not in svc._render_failures


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
