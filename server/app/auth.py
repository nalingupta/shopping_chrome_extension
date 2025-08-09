from typing import Optional


def verify_jwt(token: Optional[str]) -> bool:
    # Phase 5: implement JWT verification (python-jose) and origin checks
    if not token:
        return False
    # For Phase 1 scaffolding, accept any non-empty token
    return True


