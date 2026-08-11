package com.ktb.chatapp.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.ktb.chatapp.model.MessageType;
import org.junit.jupiter.api.Test;

class MongoConfigTest {

    private final MongoConfig.MessageTypeReadConverter converter =
            new MongoConfig.MessageTypeReadConverter();

    @Test
    void readsLegacyUppercaseMessageType() {
        assertEquals(MessageType.text, converter.convert("TEXT"));
        assertEquals(MessageType.system, converter.convert("SYSTEM"));
    }

    @Test
    void keepsCurrentLowercaseMessageTypeCompatible() {
        assertEquals(MessageType.ai, converter.convert("ai"));
        assertEquals(MessageType.file, converter.convert("file"));
    }
}
