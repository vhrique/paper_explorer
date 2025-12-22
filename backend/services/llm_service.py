"""
LLM Service for interfacing with Ollama using OpenAI SDK.
Provides a simple abstraction for chat completions using Gemma3 4b model.
"""

import os
from typing import List, Dict, Optional, Iterator
from openai import OpenAI


class LLMService:
    """Service for interacting with Ollama LLM via OpenAI-compatible API."""
    
    def __init__(self, base_url: Optional[str] = None, model: str = "gemma3-32k"):
        """
        Initialize the LLM service.
        
        Args:
            base_url: Ollama API base URL (defaults to OLLAMA_BASE_URL env var or http://localhost:11434)
            model: Model name to use (defaults to gemma3-32k with 32k context window)
        """
        self.base_url = base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.model = model
        
        # OpenAI client configured for Ollama - no API key needed for local Ollama
        self.client = OpenAI(
            base_url=f"{self.base_url}/v1",
            api_key="ollama"  # Ollama doesn't require a real API key, but OpenAI SDK requires something
        )
    
    def chat(
        self,
        messages: List[Dict[str, str]],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        stream: bool = False
    ) -> str | Iterator[str]:
        """
        Send a chat completion request.
        
        Args:
            messages: List of message dicts with 'role' and 'content' keys
            temperature: Sampling temperature (0-1)
            max_tokens: Maximum tokens to generate
            stream: Whether to stream the response
            
        Returns:
            Generated text response or iterator of text chunks if streaming
            
        Example:
            >>> llm = LLMService()
            >>> response = llm.chat([
            ...     {"role": "system", "content": "You are a helpful assistant."},
            ...     {"role": "user", "content": "What is machine learning?"}
            ... ])
        """
        try:
            kwargs = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "stream": stream
            }
            
            if max_tokens is not None:
                kwargs["max_tokens"] = max_tokens
            
            response = self.client.chat.completions.create(**kwargs)
            
            if stream:
                return self._stream_response(response)
            else:
                return response.choices[0].message.content
                
        except Exception as e:
            raise Exception(f"Error calling Ollama LLM: {str(e)}")
    
    def _stream_response(self, response) -> Iterator[str]:
        """
        Stream response chunks.
        
        Args:
            response: Streaming response from OpenAI client
            
        Yields:
            Text chunks from the response
        """
        for chunk in response:
            if chunk.choices[0].delta.content is not None:
                yield chunk.choices[0].delta.content
    
    def simple_prompt(self, prompt: str, system_message: Optional[str] = None) -> str:
        """
        Simplified interface for single-turn prompts.
        
        Args:
            prompt: User prompt
            system_message: Optional system message to set context
            
        Returns:
            Generated text response
            
        Example:
            >>> llm = LLMService()
            >>> response = llm.simple_prompt("Explain neural networks in one sentence")
        """
        messages = []
        if system_message:
            messages.append({"role": "system", "content": system_message})
        messages.append({"role": "user", "content": prompt})
        
        return self.chat(messages)


# Singleton instance for easy import
_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMService:
    """
    Get or create the singleton LLM service instance.
    
    Returns:
        LLMService instance
    """
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
