#!/usr/bin/env python3
import argparse
import os
import sys

try:
    from google import genai
    from google.genai import types as genai_types
except Exception as e:  # pragma: no cover
    sys.stderr.write(
        "google-genai is not installed. Install with: pip install google-genai\n"
    )
    raise


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vertex AI quick check using google.genai Client"
    )
    parser.add_argument("--project", required=True, help="GCP project ID")
    parser.add_argument("--location", default="us-central1", help="GCP region")
    parser.add_argument(
        "--model",
        default="gemini-2.0-flash-001",
        help="Single model ID (e.g. gemini-2.0-flash-001)",
    )
    parser.add_argument(
        "--models",
        default="",
        help="Comma-separated list of model IDs to probe (overrides --model)",
    )
    parser.add_argument(
        "--prompt",
        default="Say hi in one word.",
        help="User prompt text",
    )
    parser.add_argument(
        "--tokens",
        type=int,
        default=256,
        help="Max output tokens",
    )
    args = parser.parse_args()

    sa = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if not sa or not os.path.exists(sa):
        sys.stderr.write(
            "GOOGLE_APPLICATION_CREDENTIALS is not set to an existing file.\n"
        )
        return 2

    print(
        f"Auth: ADC via service account file set (GOOGLE_APPLICATION_CREDENTIALS)\n"
        f"Project: {args.project}  Location: {args.location}"
    )

    client = genai.Client(vertexai=True, project=args.project, location=args.location)

    contents = [
        genai_types.Content(
            role="user",
            parts=[genai_types.Part.from_text(text=args.prompt)],
        )
    ]

    # Keep config minimal to avoid enum mismatches across versions
    config = genai_types.GenerateContentConfig(
        temperature=0.7, top_p=0.95, max_output_tokens=args.tokens
    )

    # Build model list
    model_ids = []
    if args.models.strip():
        model_ids = [m.strip() for m in args.models.split(",") if m.strip()]
    else:
        model_ids = [args.model]

    any_success = False
    print("\nProbing models:")
    for model_id in model_ids:
        shown_chars = 0
        try:
            first_text = []
            for chunk in client.models.generate_content_stream(
                model=model_id, contents=contents, config=config
            ):
                txt = getattr(chunk, "text", None)
                if txt:
                    if shown_chars == 0:
                        first_text.append(txt)
                    shown_chars += len(txt)
                    if shown_chars > 400:
                        break
            if first_text:
                out = "".join(first_text).strip().replace("\n", " ")
                print(f"- {model_id}: OK -> {out[:120]}")
                any_success = True
            else:
                print(f"- {model_id}: ERROR -> no text")
        except Exception as e:  # pragma: no cover
            print(f"- {model_id}: ERROR -> {e}")

    return 0 if any_success else 6


if __name__ == "__main__":
    raise SystemExit(main())


