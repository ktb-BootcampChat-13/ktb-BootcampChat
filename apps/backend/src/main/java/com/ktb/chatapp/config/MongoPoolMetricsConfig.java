package com.ktb.chatapp.config;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.mongodb.DefaultMongoConnectionPoolTagsProvider;
import io.micrometer.core.instrument.binder.mongodb.MongoMetricsConnectionPoolListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Supplies Micrometer's standard MongoDB pool listener. Spring Boot's Mongo metrics
 * auto-configuration attaches this bean to the auto-configured MongoClient.
 */
@Configuration(proxyBeanMethods = false)
public class MongoPoolMetricsConfig {

    @Bean
    MongoMetricsConnectionPoolListener mongoMetricsConnectionPoolListener(MeterRegistry registry) {
        return new MongoMetricsConnectionPoolListener(
                registry, new DefaultMongoConnectionPoolTagsProvider());
    }
}
