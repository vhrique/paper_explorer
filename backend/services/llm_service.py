"""
LLM service using any OpenAI-compatible API.
Works with LM Studio, Ollama, OpenAI, or any compatible provider.

Required env vars:
  LLM_BASE_URL  — e.g. http://localhost:1234/v1
  LLM_API_KEY   — any string for local providers
  LLM_MODEL     — e.g. gemma3-32k
"""

import os
from typing import List, Dict, Optional
from openai import OpenAI


class LLMService:
    def __init__(self):
        base_url = os.getenv("LLM_BASE_URL", "http://localhost:1234/v1")
        api_key = os.getenv("LLM_API_KEY", "lm-studio")
        self.model = os.getenv("LLM_MODEL", "gemma3")
        self.client = OpenAI(base_url=base_url, api_key=api_key)

    def chat(self, messages: List[Dict[str, str]], temperature: float = 0.3, max_tokens: Optional[int] = None) -> str:
        kwargs = {"model": self.model, "messages": messages, "temperature": temperature}
        if max_tokens:
            kwargs["max_tokens"] = max_tokens
        response = self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return self.chat(messages)


_service: LLMService | None = None

def get_llm_service() -> LLMService:
    global _service
    if _service is None:
        _service = LLMService()
    return _service
