import httpx
import asyncio
import time

async def test_backend():
    # Тестируем прямой доступ к бэкенду (предполагаем, что он на localhost:8000)
    url = "http://127.0.0.1:8000/health"
    print(f"Testing {url}...")
    try:
        async with httpx.AsyncClient() as client:
            start = time.time()
            response = await client.get(url, timeout=5.0)
            duration = time.time() - start
            print(f"Status: {response.status_code}")
            print(f"Duration: {duration:.4f}s")
            print(f"Headers: {dict(response.headers)}")
            print(f"Body: {response.text[:200]}")
    except Exception as e:
        print(f"Error connecting to backend: {e}")

if __name__ == "__main__":
    asyncio.run(test_backend())
