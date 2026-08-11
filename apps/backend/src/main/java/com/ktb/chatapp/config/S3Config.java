package com.ktb.chatapp.config;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@Configuration
public class S3Config {

    @Bean
    S3Client s3Client(
            @Value("${aws.s3.region}") String region,
            @Value("${aws.s3.endpoint:}") String endpoint,
            @Value("${aws.s3.path-style-access:false}") boolean pathStyleAccess) {
        var builder = S3Client.builder()
                .region(Region.of(region))
                .forcePathStyle(pathStyleAccess);
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint));
        }
        return builder.build();
    }

    @Bean
    S3Presigner s3Presigner(
            @Value("${aws.s3.region}") String region,
            @Value("${aws.s3.endpoint:}") String endpoint) {
        var builder = S3Presigner.builder().region(Region.of(region));
        if (!endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint));
        }
        return builder.build();
    }
}
