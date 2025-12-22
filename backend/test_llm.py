"""
Test script for LLM service to verify Ollama integration.
Run this inside the backend container.
"""

import sys
sys.path.append('/app')

from services.llm_service import get_llm_service

def test_llm_service():
    """Test the LLM service with a simple prompt."""
    print("Testing LLM Service...")
    print("-" * 50)
    
    try:
        # Get LLM service instance
        llm = get_llm_service()
        print(f"✓ LLM service initialized")
        print(f"  Base URL: {llm.base_url}")
        print(f"  Model: {llm.model}")
        print()
        
        # Test simple prompt
        print("Testing simple_prompt method...")
        response = llm.simple_prompt(
            "Explain machine learning in one sentence.",
            system_message="You are a helpful AI assistant."
        )
        print(f"✓ Response: {response}")
        print()
        
        # Test chat method with conversation
        print("Testing chat method...")
        messages = [
            {"role": "system", "content": "You are a helpful assistant that answers in brief."},
            {"role": "user", "content": "What is 2+2?"}
        ]
        response = llm.chat(messages, temperature=0.3)
        print(f"✓ Response: {response}")
        print()
        
        # Test streaming
        print("Testing streaming...")
        messages = [
            {"role": "user", "content": "Count from 1 to 5."}
        ]
        print("Stream: ", end="", flush=True)
        for chunk in llm.chat(messages, temperature=0.1, stream=True):
            print(chunk, end="", flush=True)
        print()
        print()
        
        print("=" * 50)
        print("✓ All tests passed!")
        
    except Exception as e:
        print(f"✗ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    return True

if __name__ == "__main__":
    success = test_llm_service()
    sys.exit(0 if success else 1)
