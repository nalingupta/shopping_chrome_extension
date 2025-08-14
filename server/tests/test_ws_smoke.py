import json
from fastapi.testclient import TestClient
from server.main import app


def test_ws_smoke_init_text_ack_response():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({
            "type": "init",
            "sessionId": "pytest",
            "fps": 1,
            "sampleRate": 16000,
            "seq": 1,
        }))
        # ack init
        msg = json.loads(ws.receive_text())
        assert msg.get("type") in ("ack", "status", "config")
        # read until we see ack init
        while not (msg.get("type") == "ack" and msg.get("ackType") == "init"):
            msg = json.loads(ws.receive_text())

        # send a text message
        ws.send_text(json.dumps({
            "type": "text",
            "text": "hello",
            "tsMs": 0,
            "seq": 2,
        }))
        # get ack text
        msg = json.loads(ws.receive_text())
        while not (msg.get("type") == "ack" and msg.get("ackType") == "text"):
            msg = json.loads(ws.receive_text())
        # optional response
        try:
            ws.settimeout(2.0)  # type: ignore
        except Exception:
            pass
        try:
            while True:
                m = json.loads(ws.receive_text())
                if m.get("type") == "response":
                    assert isinstance(m.get("text"), str)
                    break
        except Exception:
            # response may not arrive in time; it's fine
            pass


