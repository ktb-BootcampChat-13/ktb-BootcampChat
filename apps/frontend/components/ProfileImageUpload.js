import React, { useState, useRef, useEffect } from 'react';
import { CameraIcon, CloseOutlineIcon } from '@vapor-ui/icons';
import { Button, Text, Callout, IconButton, VStack, HStack } from '@vapor-ui/core';
import { useAuth } from '@/contexts/AuthContext';
import CustomAvatar from '@/components/CustomAvatar';
import { Toast } from '@/components/Toast';
import api from '@/lib/api/client';
import { saveStoredUser } from '@/lib/auth/authStorage';

const ProfileImageUpload = ({ currentImage, onImageChange }) => {
  const { user } = useAuth();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // 프로필 이미지 URL 생성
  const getProfileImageUrl = (imagePath) => {
    if (!imagePath) return null;
    return imagePath.startsWith('http') ? 
      imagePath : 
      `${process.env.NEXT_PUBLIC_API_URL}${imagePath}`;
  };

  // 컴포넌트 마운트 시 이미지 설정
  useEffect(() => {
    const imageUrl = getProfileImageUrl(currentImage);
    setPreviewUrl(imageUrl);
  }, [currentImage]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // 이미지 파일 검증
      if (!file.type.startsWith('image/')) {
        throw new Error('이미지 파일만 업로드할 수 있습니다.');
      }

      // 파일 크기 제한 (5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('파일 크기는 5MB를 초과할 수 없습니다.');
      }

      setUploading(true);
      setError('');

      // 파일 미리보기 생성
      const objectUrl = URL.createObjectURL(file);
      setPreviewUrl(objectUrl);

      // 인증 정보 확인
      if (!user?.token) {
        throw new Error('인증 정보가 없습니다.');
      }

      const formData = new FormData();
      formData.append('profileImage', file);
      const response = await api.post('/api/users/profile-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        maxRetries: 0,
      });

      const data = response.data;

      if (!data?.imageUrl) {
        throw new Error(data?.message || '이미지 업로드에 실패했습니다.');
      }

      if (process.env.NEXT_PUBLIC_FILE_UPLOAD_MODE === 'mirror') {
        mirrorProfileImage(file).catch((mirrorError) => {
          console.warn('S3 profile mirror upload failed', mirrorError?.message || mirrorError);
        });
      }

      const updatedUser = {
        ...user,
        profileImage: data.imageUrl
      };
      saveStoredUser(updatedUser);

      onImageChange(data.imageUrl);

      Toast.success('프로필 이미지가 변경되었습니다.');

      window.dispatchEvent(new Event('userProfileUpdate'));

    } catch (error) {
      console.error('Image upload error:', error);
      setError(error.message);
      setPreviewUrl(getProfileImageUrl(currentImage));
      
      // 기존 objectUrl 정리
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveImage = async () => {
    try {
      setUploading(true);
      setError('');

      // 인증 정보 확인
      if (!user?.token) {
        throw new Error('인증 정보가 없습니다.');
      }

      await api.delete('/api/users/profile-image');

      // 로컬 스토리지의 사용자 정보 업데이트
      const updatedUser = {
        ...user,
        profileImage: ''
      };
      saveStoredUser(updatedUser);

      // 기존 objectUrl 정리
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }

      setPreviewUrl(null);
      onImageChange('');

      // 전역 이벤트 발생
      window.dispatchEvent(new Event('userProfileUpdate'));

    } catch (error) {
      console.error('Image removal error:', error);
      setError(error.message);
    } finally {
      setUploading(false);
    }
  };

  // 컴포넌트 언마운트 시 cleanup
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  return (
    <VStack $css={{ gap: '$300', alignItems: 'center' }}>
      <CustomAvatar
        user={user}
        size="xl"
        persistent={true}
        showInitials={true}
        data-testid="profile-image-avatar"
      />
      
      <HStack $css={{ gap: '$200', justifyContent: 'center' }}>
        <Button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="profile-image-upload-button"
        >
          <CameraIcon />
          이미지 변경
        </Button>

        {previewUrl && (
          <Button
            type="button"
            variant="fill"
            colorPalette="danger"
            onClick={handleRemoveImage}
            disabled={uploading}
            data-testid="profile-image-delete-button"
          >
            <CloseOutlineIcon />
            이미지 삭제
          </Button>
        )}
      </HStack>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/*"
        onChange={handleFileSelect}
        data-testid="profile-image-file-input"
      />

      {error && (
        <Callout.Root colorPalette="danger">
          <HStack $css={{ gap: '$200', alignItems: 'center' }}>
            <Text>{error}</Text>
          </HStack>
        </Callout.Root>
      )}

      {uploading && (
        <Text typography="body3" foreground="hint-100">
          이미지 업로드 중...
        </Text>
      )}
    </VStack>
  );
};

const mirrorProfileImage = async (file) => {
  let uploadId;
  const startedAt = Date.now();
  try {
    const intent = await api.post('/api/users/profile-image/presign', {
      originalFilename: file.name,
      contentType: file.type,
      size: file.size,
    }, { maxRetries: 0 });
    uploadId = intent.data.uploadId;
    const putResponse = await fetch(intent.data.uploadUrl, {
      method: 'PUT',
      headers: intent.data.headers,
      body: file,
      credentials: 'omit',
    });
    if (!putResponse.ok) {
      const error = new Error('S3 mirror upload failed');
      error.status = putResponse.status;
      throw error;
    }
    await api.post('/api/users/profile-image/mirror-result', {
      uploadId, success: true, status: putResponse.status, durationMs: Date.now() - startedAt,
    }, { maxRetries: 0 });
  } catch (error) {
    if (uploadId) {
      await api.post('/api/users/profile-image/mirror-result', {
        uploadId, success: false, status: error.status || error.response?.status || 0,
        durationMs: Date.now() - startedAt,
      }, { maxRetries: 0 }).catch(() => {});
    }
    throw error;
  }
};

export default ProfileImageUpload;
