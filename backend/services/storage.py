import boto3
import os
from botocore.exceptions import ClientError

class S3StorageService:
    def __init__(self):
        self.s3_client = boto3.client(
            's3',
            endpoint_url=f"http://{os.getenv('MINIO_ENDPOINT', 'localhost:9000')}",
            aws_access_key_id=os.getenv('MINIO_ACCESS_KEY', 'minioadmin'),
            aws_secret_access_key=os.getenv('MINIO_SECRET_KEY', 'minioadmin'),
            config=boto3.session.Config(signature_version='s3v4')
        )
        self.bucket_name = os.getenv('MINIO_BUCKET_NAME', 'paper-explorer')

    def upload_file(self, file_obj, object_name, content_type=None):
        """Upload a file to an S3 bucket"""
        try:
            extra_args = {}
            if content_type:
                extra_args['ContentType'] = content_type
                
            self.s3_client.upload_fileobj(file_obj, self.bucket_name, object_name, ExtraArgs=extra_args)
            return True
        except ClientError as e:
            print(f"Error uploading file: {e}")
            return False

    def get_presigned_url(self, object_name, expiration=3600):
        """Generate a presigned URL to share an S3 object"""
        try:
            response = self.s3_client.generate_presigned_url('get_object',
                                                            Params={'Bucket': self.bucket_name,
                                                                    'Key': object_name},
                                                            ExpiresIn=expiration)
        except ClientError as e:
            print(f"Error generating presigned URL: {e}")
            return None

        # If running in Docker, the URL might contain the internal container name (minio).
        # For the frontend (browser) to access it, we might need to replace it with localhost
        # if we are running locally.
        # However, since we are mapping ports 9000:9000, localhost:9000 should work if the endpoint was localhost.
        # But if the endpoint was 'minio:9000' (internal), the signed URL will have 'minio:9000'.
        # The browser cannot resolve 'minio'.
        
        # Hack for local development with Docker Compose:
        # Replace 'minio:9000' with 'localhost:9000' for browser access
        if 'minio:9000' in response:
             response = response.replace('minio:9000', 'localhost:9000')
             
        return response

    def delete_file(self, object_name):
        """Delete a file from an S3 bucket"""
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=object_name)
            return True
        except ClientError as e:
            print(f"Error deleting file: {e}")
            return False
