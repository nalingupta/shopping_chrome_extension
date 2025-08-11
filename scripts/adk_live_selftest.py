#!/usr/bin/env python3
import argparse
import asyncio
import os
import sys

try:
    from google import genai
    from google.genai import types as genai_types
except Exception:
    sys.stderr.write("pip install google-genai\n")
    raise


async def check_text(client: genai.Client, model: str) -> bool:  # type: ignore
    try:
        async with client.aio.live.connect(model=model, config={"response_modalities": ["TEXT"]}) as s:
            # Use client_content turn to align with documented patterns
            await s.send_client_content(
                turns=genai_types.Content(
                    role="user",
                    parts=[genai_types.Part.from_text(text="Say hi in one word.")],
                )
            )
            stream = s.receive()
            for _ in range(20):
                try:
                    evt = await asyncio.wait_for(stream.__anext__(), timeout=3.0)
                except asyncio.TimeoutError:
                    continue
                txt = getattr(evt, "text", None)
                if isinstance(txt, str) and txt:
                    print(f"text_ok -> {txt[:40]}")
                    return True
    except Exception as e:
        print(f"text_error -> {e}")
        return False
    return False


async def check_media(client: genai.Client, model: str) -> bool:  # type: ignore
    try:
        cfg = {"response_modalities": ["TEXT"], "input_audio_transcription": {}}
        async with client.aio.live.connect(model=model, config=cfg) as s:
            # Send one tiny JPEG frame
            import base64
            jpeg_b64 = (
                "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////2wBDAf//////////////////////////////////////////wAARCABkAGQDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAgT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfAAH/2Q=="
            )
            jpeg_bytes = base64.b64decode(jpeg_b64)
            await s.send_realtime_input(
                video=genai_types.Blob(data=jpeg_bytes, mime_type="image/jpeg")
            )

            # Send 1s PCM16 @16kHz
            import array
            pcm16 = array.array("h", [0] * 16000).tobytes()
            await s.send_realtime_input(
                audio=genai_types.Blob(data=pcm16, mime_type="audio/pcm;rate=16000")
            )

            # Provide a user prompt and mark turn complete
            await s.send_client_content(
                turns=genai_types.Content(
                    role="user",
                    parts=[genai_types.Part.from_text(text="Briefly describe the image.")],
                ),
                turn_complete=True,
            )

            stream = s.receive()
            got_any = False
            got_text = False
            for _ in range(30):
                try:
                    evt = await asyncio.wait_for(stream.__anext__(), timeout=2.0)
                except asyncio.TimeoutError:
                    continue
                if evt is None:
                    continue
                got_any = True
                txt = getattr(evt, "text", None)
                if isinstance(txt, str) and txt:
                    got_text = True
                    break
            if got_any:
                print(f"audio_ok text={'yes' if got_text else 'no'}")
                return True
    except Exception as e:
        print(f"audio_error -> {e}")
        return False
    return False


async def _run(project: str, location: str, model: str) -> int:
    client = genai.Client(vertexai=True, project=project, location=location)
    ok_text = await check_text(client, model)
    ok_media = await check_media(client, model)
    print(f"summary: text={'OK' if ok_text else 'FAIL'} media={'OK' if ok_media else 'FAIL'}")
    return 0 if (ok_text and ok_media) else 10


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--project", required=True)
    p.add_argument("--location", default="us-central1")
    p.add_argument("--model", default="gemini-live-2.5-flash")
    args = p.parse_args()

    sa = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not sa or not os.path.exists(sa):
        sys.stderr.write("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.\n")
        return 2

    return asyncio.run(_run(args.project, args.location, args.model))


if __name__ == "__main__":
    raise SystemExit(main())


