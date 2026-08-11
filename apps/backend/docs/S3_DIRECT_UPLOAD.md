# S3 direct upload prerequisites

Apply these bucket settings before enabling the direct-upload frontend. Replace the origin with the
real frontend origin; do not use `*`.

```json
[
  {
    "AllowedOrigins": ["https://your-frontend.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "x-amz-*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Configure a lifecycle rule that expires objects with the `pending/` prefix after one day (S3's
minimum lifecycle granularity). MongoDB removes expired intent metadata through its TTL index after
15 minutes. Presigned PUT URLs expire after five minutes.

Set `NEXT_PUBLIC_DIRECT_S3_UPLOAD=false` for a one-release rollback to the deprecated Multipart
endpoints. Remove that path and both Multipart controllers in the following release.
