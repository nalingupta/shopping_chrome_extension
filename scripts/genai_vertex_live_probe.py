#!/usr/bin/env python3
import argparse
import asyncio
import os
import sys

try:
    from google import genai
    from google.genai import types as genai_types
except Exception:
    sys.stderr.write("google-genai is not installed. Install with: pip install google-genai\n")
    raise


async def probe_live(model: str, project: str, location: str, prompt: str) -> int:
    client = genai.Client(vertexai=True, project=project, location=location)
    try:
        async with client.aio.live.connect(
            model=model,
            config={"response_modalities": ["TEXT"]},
        ) as session:
            print("Connected to Live session.")
            # Try sending a short text input; fall back if API shape differs
            sent = False
            try:
                # Preferred: high-level text input
                await session.send_realtime_input(text=prompt)
                sent = True
            except Exception:
                try:
                    # Fallback: send Content/Part
                    content = genai_types.Content(
                        role="user",
                        parts=[genai_types.Part.from_text(text=prompt)],
                    )
                    await session.send_realtime_input(content=content)
                    sent = True
                except Exception:
                    pass
            if not sent:
                print("Warning: could not send text via send_realtime_input; proceeding to receive events only.")

            # Read a few events to confirm text output
            received_text = []
            try:
                stream = session.receive()
                for _ in range(20):
                    try:
                        evt = await asyncio.wait_for(stream.__anext__(), timeout=3.0)
                    except asyncio.TimeoutError:
                        continue
                    txt = getattr(evt, "text", None)
                    if isinstance(txt, str) and txt:
                        received_text.append(txt)
                        if sum(len(t) for t in received_text) > 100:
                            break
            except Exception as e:
                print(f"Receive error: {e}")

            if received_text:
                joined = "".join(received_text).strip().replace("\n", " ")
                print(f"Live OK -> {joined[:200]}")
                return 0
            else:
                print("Live connected but no text received (may still be entitled; check input method).")
                return 10
    except Exception as e:
        print(f"Live error: {e}")
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Vertex Live API probe")
    parser.add_argument("--project", required=True)
    parser.add_argument("--location", default="us-central1")
    parser.add_argument("--model", default="gemini-2.0-flash-live-preview-04-09")
    parser.add_argument("--prompt", default="Say hi in one word.")
    args = parser.parse_args()

    sa = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not sa or not os.path.exists(sa):
        sys.stderr.write("Set GOOGLE_APPLICATION_CREDENTIALS to your service account file.\n")
        return 2

    print(f"Project: {args.project}  Location: {args.location}  Model: {args.model}")
    return asyncio.run(probe_live(args.model, args.project, args.location, args.prompt))


if __name__ == "__main__":
    raise SystemExit(main())


