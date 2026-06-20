import asyncio
import logging
from typing import List, Tuple
from pydantic import BaseModel, Field
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.output_parsers import PydanticOutputParser
from langchain.chat_models import init_chat_model
from utils.image import image_path_to_b64

system_prompt_template_select_reference_images_only_text = \
"""
[Role]
You are a professional visual creation assistant skilled in multimodal image analysis and reasoning.

[Task]
Your core task is to intelligently select the most suitable reference images from a provided set of reference image descriptions (including multiple character reference images and existing scene images from prior frames) based on the user's text description (describing the target frame), ensuring that the subsequently generated image meets the following key consistencies:
- Character Consistency: The appearance (e.g. gender, ethnicity, age, facial features, hairstyle, body shape), clothing, expression, posture, etc., of the generated character should highly match the reference image descriptions.
- Environmental Consistency: The scene of the generated image (e.g., background, lighting, atmosphere, layout) should remain coherent with the existing image descriptions from prior frames.
- Style Consistency: The visual style of the generated image (e.g., realistic, cartoon, film-like, color tone) should harmonize with the reference image descriptions.

[Input]
You will receive a text description of the target frame, along with a sequence of reference image descriptions.
- The text description of the target frame is enclosed within <FRAME_DESC> and </FRAME_DESC>.
- The sequence of reference image descriptions is enclosed within <SEQ_DESC> and </SEQ_DESC>. Each description is prefixed with its index, starting from 0.

Below is an example of the input format:
<FRAME_DESC>
[Camera 1] Shot from Alice's over-the-shoulder perspective. Alice is on the side closer to the camera, with only her shoulder appearing in the lower left corner of the frame. Bob is on the side farther from the camera, positioned slightly right of center in the frame. Bob's expression shifts from surprise to delight as he recognizes Alice.
</FRAME_DESC>

<SEQ_DESC>
Image 0: A front-view portrait of Alice.
Image 1: A front-view portrait of Bob.
Image 2: [Camera 0] Medium shot of the supermarket aisle. Alice and Bob are shown in profile facing the right side of the frame. Bob is on the right side of the frame, and Alice is on the left side. Alice, looking down and pushing a shopping cart, follows closely behind Bob and accidentally bumps into his heel.
Image 3: [Camera 1] Shot from Alice's over-the-shoulder perspective. Alice is on the side closer to the camera, with only her shoulder appearing in the lower left corner of the frame. Bob is on the side farther from the camera, positioned slightly right of center in the frame. Bob quickly turns around, and his expression shifts from neutral to surprised.
Image 4: [Camera 2] Shot from Bob's over-the-shoulder perspective. Bob is on the side closer to the camera, with only his shoulder appearing in the lower right corner of the frame. Alice is on the side farther from the camera, positioned slightly left of center in the frame. Alice looks down, then up as she prepares to apologize. Upon realizing it's someone familiar, her expression shifts to one of surprise.
</SEQ_DESC>


[Output]
You need to select up to 8 of the most relevant reference images based on the user's description and put the corresponding indices in the ref_image_indices field of the output. At the same time, you should generate a text prompt that describes the image to be created, specifying which elements in the generated image should reference which image description (and which elements within it).

{format_instructions}


[Guidelines]
- Ensure that the language of all output values (not include keys) matches that used in the frame description.
- The reference image descriptions may depict the same character from different angles, in different outfits, or in different scenes. Identify the description closest to the version described by the user
- Prioritize image descriptions with similar compositions, i.e., shots taken by the same camera.
- The images from prior frames are arranged in chronological order. Give higher priority to more recent images (those closer to the end of the sequence).
- Choose reference image descriptions that are as concise as possible and avoid including duplicate information. For example, if Image 3 depicts the facial features of Bob from the front, and Image 1 also depicts Bob's facial features from the front-view portrait, then Image 1 is redundant and should not be selected.
- When a new character appears in the frame description, prioritize selecting their portrait image description (if available) to ensure accurate depiction of their appearance. Pay attention to whether the character is facing the camera from the front, side, or back. Choose the most suitable view as the reference image for the character.
- For character portraits, you can only select at most one image from multiple views (front, side, back). Choose the most appropriate one based on the frame description. For example, when depicting a character from the side, choose the side view of the character.
- Select at most **8** optimal reference image descriptions.
"""


system_prompt_template_select_reference_images_multimodal = \
"""
[Role]
You are a professional visual creation assistant skilled in multimodal image analysis and reasoning.

[Task]
Your core task is to intelligently select the most suitable reference images from a provided reference image library (including multiple character reference images and existing scene images from prior frames) based on the user's text description (describing the target frame), ensuring that the subsequently generated image meets the following key consistencies:
- Character Consistency: The appearance (e.g. gender, ethnicity, age, facial features, hairstyle, body shape), clothing, expression, posture, etc., of the generated character should highly match the reference images.
- Environmental Consistency: The scene of the generated image (e.g., background, lighting, atmosphere, layout) should remain coherent with the existing images from prior frames.
- Style Consistency: The visual style of the generated image (e.g., realistic, cartoon, film-like, color tone) should harmonize with the reference images and existing images.

[Input]
You will receive a text description of the target frame, along with a sequence of reference images.
- The text description of the target frame is enclosed within <FRAME_DESC> and </FRAME_DESC>.
- The sequence of reference images is enclosed within <SEQ_IMAGES> and </SEQ_IMAGES>. Each reference image is provided with a text description. The reference images are indexed starting from 0.

Below is an example of the input format:
<FRAME_DESC>
[Camera 1] Shot from Alice's over-the-shoulder perspective. <Alice> is on the side closer to the camera, with only her shoulder appearing in the lower left corner of the frame. <Bob> is on the side farther from the camera, positioned slightly right of center in the frame. <Bob>'s expression shifts from surprise to delight as he recognizes <Alice>.
</FRAME_DESC>

<SEQ_IMAGES>
Image 0: A front-view portrait of Alice.
[Image 0 here]
Image 1: A front-view portrait of Bob.
[Image 1 here]
Image 2: [Camera 0] Medium shot of the supermarket aisle. Alice and Bob are shown in profile facing the right side of the frame. Bob is on the right side of the frame, and Alice is on the left side. Alice, looking down and pushing a shopping cart, follows closely behind Bob and accidentally bumps into his heel.
[Image 2 here]
Image 3: [Camera 1] Shot from Alice's over-the-shoulder perspective. Alice is on the side closer to the camera, with only her shoulder appearing in the lower left corner of the frame. Bob is on the side farther from the camera, positioned slightly right of center in the frame. Bob is back to the camera.
[Image 3 here]
Image 4: [Camera 2] Shot from Bob's over-the-shoulder perspective. Bob is on the side closer to the camera, with only his shoulder appearing in the lower right corner of the frame. Alice is on the side farther from the camera, positioned slightly left of center in the frame. Alice looks down, then up as she prepares to apologize. Upon realizing it's someone familiar, her expression shifts to one of surprise.
</SEQ_IMAGES>

[Output]
You need to select the most relevant reference images based on the user's description and put the corresponding indices in the `ref_image_indices` field of the output. At the same time, you should generate a text prompt that describes the image to be created, specifying which elements in the generated image should reference which image (and which elements within it).

{format_instructions}


[Guidelines]
- Ensure that the language of all output values (not include keys) matches that used in the frame description.
- The reference image descriptions may depict the same character from different angles, in different outfits, or in different scenes. Identify the description closest to the version described by the user
- Prioritize image descriptions with similar compositions, i.e., shots taken by the same camera.
- The images from prior frames are arranged in chronological order. Give higher priority to more recent images (those closer to the end of the sequence).
- Choose reference image descriptions that are as concise as possible and avoid including duplicate information. For example, if Image 3 depicts the facial features of Bob from the front, and Image 1 also depicts Bob's facial features from the front-view portrait, then Image 1 is redundant and should not be selected.
- For character portraits, you can only select at most one image from multiple views (front, side, back). Choose the most appropriate one based on the frame description. For example, when depicting a character from the side, choose the side view of the character.
- Select at most **8** optimal reference image descriptions.
- The text guiding image editing should be as concise as possible.
"""


human_prompt_template_select_reference_images = \
"""
<FRAME_DESC>
{frame_description}
</FRAME_DESC>
"""




class RefImageIndicesAndTextPrompt(BaseModel):
    ref_image_indices: List[int] = Field(
        description="Indices of reference images selected from the provided images. For example, [0, 2, 5] means selecting the first, third, and sixth images. The indices should be 0-based.",
        examples=[
            [1, 3]
        ]
    )
    text_prompt: str = Field(
        description="Text description to guide the image generation. You need to describe the image to be generated, specifying which elements in the generated image should reference which image (and which elements within it). For example, 'Create an image following the given description: \nThe man is standing in the landscape. The man should reference Image 0. The landscape should reference Image 1.' Here, the index of the reference image should refer to its position in the ref_image_indices list, not the sequence number in the provided image list. Refer to the reference image must be in the format of Image N. Do not use any other word except Image.",
        examples=[
            "Create an image based on the following guidance: \n Make modifications based on Image 1: Bob's body turns to face the camera, while all other elements remain unchanged. Bob's appearance should refer to Image 0.",
            "Create an image following the given description: \nThe man is standing in the landscape. The man should reference Image 0. The landscape should reference Image 1."
        ]
    )



class ReferenceImageSelector:
    def __init__(
        self,
        chat_model,
    ):

        self.chat_model = chat_model


    async def select_reference_images_and_generate_prompt(
        self,
        available_image_path_and_text_pairs: List[Tuple[str, str]],
        frame_description: str,
    ) -> dict:
        """Select reference images and generate a text prompt for image generation.

        Returns a plain dict with keys ``ref_image_indices`` (indices into
        *available_image_path_and_text_pairs*) and ``text_prompt``.  Callers
        can ``json.dump`` the result directly — no ``.model_dump()`` needed.

        Retry policy: only transient LLM errors (network, timeout) are retried
        once.  Deterministic errors (empty input, invalid indices, parsing
        failures) fail fast or fall back to using the full set without wasting
        API credits on futile retries.
        """
        # ── Input validation: fail fast on empty input ──────────────────
        if not available_image_path_and_text_pairs:
            return {
                "ref_image_indices": [],
                "text_prompt": frame_description,
            }

        # ── Guard: skip LLM when too few images (text-only models like
        #    DeepSeek cannot handle the multimodal path, and with < 8 images
        #    the selection is trivial). ───────────────────────────────────
        if len(available_image_path_and_text_pairs) < 8:
            return {
                "ref_image_indices": list(range(len(available_image_path_and_text_pairs))),
                "text_prompt": frame_description,
            }

        # ── Step 1: text-only pre-filter (retry once on transient errors) ──
        step1_indices: List[int] = []
        for attempt in range(2):
            try:
                human_content = []
                for idx, (_, text) in enumerate(available_image_path_and_text_pairs):
                    human_content.append({"type": "text", "text": f"Image {idx}: {text}"})
                human_content.append({
                    "type": "text",
                    "text": human_prompt_template_select_reference_images.format(
                        frame_description=frame_description)
                })
                parser = PydanticOutputParser(pydantic_object=RefImageIndicesAndTextPrompt)
                messages = [
                    SystemMessage(content=system_prompt_template_select_reference_images_only_text.format(
                        format_instructions=parser.get_format_instructions())),
                    HumanMessage(content=human_content)
                ]
                chain = self.chat_model | parser
                ref = await chain.ainvoke(messages)
                step1_indices = list(dict.fromkeys(ref.ref_image_indices))  # dedup, keep order
                select_pairs_by_indices(available_image_path_and_text_pairs, step1_indices)
                logging.info("Step 1 filtered indices: %s", step1_indices)
                break  # success
            except ValueError:
                logging.error(
                    "Step 1 returned invalid indices for %d images, using full set.",
                    len(available_image_path_and_text_pairs))
                step1_indices = list(range(len(available_image_path_and_text_pairs)))
                break
            except Exception:
                if attempt == 0:
                    logging.warning("Step 1 transient error (attempt 1/2), retrying...")
                    await asyncio.sleep(2)
                else:
                    logging.error("Step 1 failed after 2 attempts, using full set.")
                    step1_indices = list(range(len(available_image_path_and_text_pairs)))

        filtered_pairs = [available_image_path_and_text_pairs[i] for i in step1_indices]

        # ── Step 2: multimodal final selection ──────────────────────────
        if not filtered_pairs:
            return {
                "ref_image_indices": [],
                "text_prompt": frame_description,
            }

        # ── Step 2: multimodal final selection (retry once on transient errors) ──
        human_content = []
        for idx, (image_path, text) in enumerate(filtered_pairs):
            human_content.append({"type": "text", "text": f"Image {idx}: {text}"})
            human_content.append({
                "type": "image_url",
                "image_url": {"url": image_path_to_b64(image_path)}
            })
        human_content.append({
            "type": "text",
            "text": human_prompt_template_select_reference_images.format(
                frame_description=frame_description)
        })

        parser = PydanticOutputParser(pydantic_object=RefImageIndicesAndTextPrompt)
        messages = [
            SystemMessage(content=system_prompt_template_select_reference_images_multimodal.format(
                format_instructions=parser.get_format_instructions())),
            HumanMessage(content=human_content)
        ]
        chain = self.chat_model | parser

        final_indices = step1_indices  # fallback default
        text_prompt = frame_description
        for attempt in range(2):
            try:
                response = await chain.ainvoke(messages)
                deduped = list(dict.fromkeys(response.ref_image_indices))  # dedup, keep order
                select_pairs_by_indices(filtered_pairs, deduped)
                final_indices = [step1_indices[i] for i in deduped]
                text_prompt = response.text_prompt
                break  # success
            except ValueError:
                logging.error(
                    "Step 2 returned invalid indices for %d filtered images, "
                    "using step-1 indices as fallback.", len(filtered_pairs))
                break  # deterministic — don't retry
            except Exception:
                if attempt == 0:
                    logging.warning("Step 2 transient error (attempt 1/2), retrying...")
                    await asyncio.sleep(2)
                else:
                    logging.error(
                        "Step 2 failed after 2 attempts, using step-1 indices as fallback.")

        return {
            "ref_image_indices": final_indices,
            "text_prompt": text_prompt,
        }




def select_pairs_by_indices(pairs, indices):
    """Index into pairs with LLM-emitted indices, rejecting out-of-range values.

    Negative indices would silently select the wrong image via Python indexing.
    """
    invalid = [i for i in indices if i < 0 or i >= len(pairs)]
    if invalid:
        raise ValueError(f"ref_image_indices out of range: {invalid} (have {len(pairs)} images)")
    return [pairs[i] for i in indices]
