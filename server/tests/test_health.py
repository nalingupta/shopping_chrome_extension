from fastapi.testclient import TestClient
from server.main import app


def test_healthz_ok():
    client = TestClient(app)
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


