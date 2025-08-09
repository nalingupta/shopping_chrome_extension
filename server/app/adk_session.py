from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class RunConfig:
    streaming_mode: str = "BIDI"
    response_modalities: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.response_modalities is None:
            self.response_modalities = ["TEXT"]


@dataclass
class ADKSession:
    model: str
    config: RunConfig
    # Placeholder fields for future ADK Agent/Runner objects
    agent: Optional[Any] = None
    runner: Optional[Any] = None


class ADKSessionFactory:
    """
    Placeholder factory. In Phase 2+, wire to google-adk + google-genai to
    construct the Agent/Runner with provided RunConfig.
    """

    @staticmethod
    def create_session(model: str, config: Optional[RunConfig] = None) -> ADKSession:
        cfg = config or RunConfig()
        return ADKSession(model=model, config=cfg)


