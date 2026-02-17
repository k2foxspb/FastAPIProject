import os
from typing import Optional
import boto3
from botocore.config import Config


YC_S3_ENDPOINT = os.getenv("YC_S3_ENDPOINT", "https://storage.yandexcloud.net")
YC_S3_REGION = os.getenv("YC_S3_REGION", "ru-central1")
YC_S3_BUCKET = os.getenv("YC_S3_BUCKET")
YC_S3_ACCESS_KEY_ID = os.getenv("YC_S3_ACCESS_KEY_ID")
YC_S3_SECRET_ACCESS_KEY = os.getenv("YC_S3_SECRET_ACCESS_KEY")
YC_S3_PUBLIC_BASE_URL = os.getenv("YC_S3_PUBLIC_BASE_URL")  # optional CDN/custom domain
YC_S3_DEFAULT_ACL = os.getenv("YC_S3_DEFAULT_ACL", "public-read")


def _client():
    return boto3.client(
        "s3",
        endpoint_url=YC_S3_ENDPOINT,
        region_name=YC_S3_REGION,
        aws_access_key_id=YC_S3_ACCESS_KEY_ID,
        aws_secret_access_key=YC_S3_SECRET_ACCESS_KEY,
        config=Config(s3={"addressing_style": "virtual"}),
    )


def make_public_url(key: str) -> str:
    """Builds a public URL for an object key."""
    if YC_S3_PUBLIC_BASE_URL:
        return f"{YC_S3_PUBLIC_BASE_URL.rstrip('/')}/{key.lstrip('/')}"
    # default Yandex Object Storage public URL
    return f"{YC_S3_ENDPOINT.rstrip('/')}/{YC_S3_BUCKET}/{key.lstrip('/')}"


def upload_fileobj(fileobj, key: str, content_type: Optional[str] = None, acl: Optional[str] = None) -> str:
    """
    Uploads bytes stream to S3 and returns the public URL (for public ACL) or the S3 key URL if private.
    """
    if not YC_S3_BUCKET:
        raise RuntimeError("YC_S3_BUCKET is not configured")

    extra_args = {}
    if content_type:
        extra_args["ContentType"] = content_type
    if acl or YC_S3_DEFAULT_ACL:
        extra_args["ACL"] = (acl or YC_S3_DEFAULT_ACL)

    client = _client()
    client.upload_fileobj(
        Fileobj=fileobj,
        Bucket=YC_S3_BUCKET,
        Key=key,
        ExtraArgs=extra_args or None,
    )

    # If object is public, return public URL. If private, return s3 URL (caller may pre-sign later)
    if (acl or YC_S3_DEFAULT_ACL) == "public-read":
        return make_public_url(key)
    return f"s3://{YC_S3_BUCKET}/{key}"


def delete_object(key: str) -> None:
    if not YC_S3_BUCKET:
        return
    client = _client()
    client.delete_object(Bucket=YC_S3_BUCKET, Key=key)
