package com.ktb.chatapp.config;

import com.ktb.chatapp.model.MessageType;
import java.util.List;
import java.util.Locale;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.data.mongodb.config.EnableMongoAuditing;
import org.springframework.data.mongodb.core.convert.MongoCustomConversions;
import org.springframework.data.convert.ReadingConverter;

@Configuration
@EnableMongoAuditing
public class MongoConfig {

    @Bean
    MongoCustomConversions mongoCustomConversions() {
        return new MongoCustomConversions(List.of(new MessageTypeReadConverter()));
    }

    @ReadingConverter
    static class MessageTypeReadConverter implements Converter<String, MessageType> {
        @Override
        public MessageType convert(String source) {
            return MessageType.valueOf(source.toLowerCase(Locale.ROOT));
        }
    }
}
