"""
Storage abstraction: local filesystem or GCS.
Controlled by STORAGE_BACKEND env var ('local' or 'gcs').
"""

import os
import io
from pathlib import Path
from typing import BinaryIO


STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")
LOCAL_STORAGE_PATH = os.getenv("LOCAL_STORAGE_PATH", "./storage")
GCS_BUCKET = os.getenv("GCS_BUCKET_NAME", "paper-explorer")


class LocalStorage:
    def __init__(self, base_path: str = LOCAL_STORAGE_PATH):
        self.base = Path(base_path)
        self.base.mkdir(parents=True, exist_ok=True)

    def upload(self, data: BinaryIO, key: str, content_type: str = "application/octet-stream") -> None:
        dest = self.base / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data.read())

    def download(self, key: str) -> bytes:
        return (self.base / key).read_bytes()

    def delete(self, key: str) -> None:
        path = self.base / key
        if path.exists():
            path.unlink()

    def get_url(self, key: str) -> str:
        return f"/api/files/{key}"

    def stream(self, key: str):
        return io.BytesIO(self.download(key))


class GCSStorage:
    def __init__(self):
        from google.cloud import storage as gcs
        self.client = gcs.Client()
        self.bucket = self.client.bucket(GCS_BUCKET)

    def upload(self, data: BinaryIO, key: str, content_type: str = "application/octet-stream") -> None:
        blob = self.bucket.blob(key)
        blob.upload_from_file(data, content_type=content_type)

    def download(self, key: str) -> bytes:
        blob = self.bucket.blob(key)
        return blob.download_as_bytes()

    def delete(self, key: str) -> None:
        blob = self.bucket.blob(key)
        if blob.exists():
            blob.delete()

    def get_url(self, key: str) -> str:
        blob = self.bucket.blob(key)
        return blob.generate_signed_url(expiration=3600)

    def stream(self, key: str):
        return io.BytesIO(self.download(key))


def get_storage():
    if STORAGE_BACKEND == "gcs":
        return GCSStorage()
    return LocalStorage()
