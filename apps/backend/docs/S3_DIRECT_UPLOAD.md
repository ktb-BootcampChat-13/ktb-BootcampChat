# S3 PutObject mirror upload

`NEXT_PUBLIC_FILE_UPLOAD_MODE=mirror`는 기존 multipart 업로드가 성공한 뒤 같은 파일을
S3 `pending/mirror/`에 best-effort로 복제한다. 서비스 원본과 응답 계약은 기존 서버
저장소를 유지하며, S3 실패는 사용자 업로드 성공을 되돌리지 않는다. 기본값은 `server`다.

백엔드는 `FILE_STORAGE_TYPE=local`, `S3_BUCKET`, `AWS_REGION`을 사용한다. IAM Role에는
`s3:PutObject`만 필요하고 애플리케이션은 미러 객체에 GET, HEAD, Copy, Delete를 호출하지
않는다. AWS 자격증명은 이미지나 환경변수에 넣지 않는다.

## Bucket CORS

`https://frontend.example.com`을 실제 운영 origin으로 바꾸고 `*`는 사용하지 않는다.

```json
[
  {
    "AllowedOrigins": ["https://frontend.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

`pending/` prefix 객체를 1일 후 삭제하는 lifecycle rule을 설정한다. PUT URL은 5분,
MongoDB intent는 15분 후 만료된다.

## Rollout

1. 기존 서버 저장소가 정상인지 확인한다.
2. 운영 이미지를 `--build-arg NEXT_PUBLIC_FILE_UPLOAD_MODE=mirror`로 빌드한다.
3. `mirror_presign_success`, `mirror_put_success`, `mirror_put_failure`를 관찰한다.
4. 문제가 생기면 프론트만 `server`로 다시 빌드한다.

이 모드는 백엔드 업로드 부하를 제거하거나 S3를 영구 원본으로 사용하지 않는다.
