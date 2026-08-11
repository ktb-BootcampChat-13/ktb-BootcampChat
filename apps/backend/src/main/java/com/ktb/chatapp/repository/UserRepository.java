package com.ktb.chatapp.repository;

import com.ktb.chatapp.model.User;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends MongoRepository<User, String> {
    Optional<User> findByEmail(String email);

    @Query(
        value = "{ '_id': { $in: ?0 } }",
        fields = "{ '_id': 1, 'name': 1, 'email': 1, 'profileImage': 1 }"
    )
    List<User> findSummariesByIdIn(Collection<String> userIds);
}
