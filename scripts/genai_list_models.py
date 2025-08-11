#!/usr/bin/env python3
import argparse
import os
import sys

try:
    from google import genai
except Exception:
    sys.stderr.write("google-genai is not installed. Install with: pip install google-genai\n")
    raise


def safe_get(obj, *keys):
    for k in keys:
        v = getattr(obj, k, None)
        if v is not None:
            return v
        if isinstance(obj, dict) and k in obj:
            return obj[k]
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="List models via google.genai")
    parser.add_argument("--project", required=False, help="GCP project ID (Vertex mode)")
    parser.add_argument("--location", default="us-central1", help="GCP region (Vertex mode)")
    parser.add_argument("--use-vertex", action="store_true", help="Use Vertex auth (ADC/service account)")
    args = parser.parse_args()

    if args.use_vertex:
        sa = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not sa or not os.path.exists(sa):
            sys.stderr.write("Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file.\n")
            return 2
        if not args.project:
            sys.stderr.write("--project is required in Vertex mode.\n")
            return 2
        client = genai.Client(vertexai=True, project=args.project, location=args.location)
        print(f"Mode: Vertex  Project: {args.project}  Location: {args.location}")
    else:
        api_key = os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            sys.stderr.write("Set GOOGLE_API_KEY for AI Studio mode or pass --use-vertex.\n")
            return 2
        client = genai.Client(api_key=api_key)
        print("Mode: AI Studio")

    try:
        models = client.models.list()
    except Exception as e:
        sys.stderr.write(f"Error listing models: {e}\n")
        return 1

    count = 0
    for m in models:
        name = safe_get(m, "name", "model")
        display = safe_get(m, "display_name", "displayName")
        if name:
            print(f"- {name} — {display or ''}")
            count += 1
    print(f"Total: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


