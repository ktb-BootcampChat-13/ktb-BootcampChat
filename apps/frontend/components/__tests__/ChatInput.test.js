import React from 'react';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ChatInput from '../ChatInput';

vi.mock('../EmojiPicker', () => ({
  default: () => React.createElement('em-emoji-picker'),
}));

describe('ChatInput', () => {
  it('renders the lazy emoji picker under React 19', async () => {
    const { container, getByLabelText } = render(
      <ChatInput
        fileInputRef={{ current: null }}
        room={{ participants: [] }}
      />
    );

    fireEvent.click(getByLabelText('이모티콘'));

    await waitFor(() => {
      expect(container.querySelector('em-emoji-picker')).toBeInTheDocument();
    });
  });

  it('waits for the socket-confirmed submit before clearing the message', async () => {
    let confirmSubmit;
    const onSubmit = vi.fn(() => new Promise((resolve) => { confirmSubmit = resolve; }));
    const { getByTestId } = render(
      <ChatInput
        fileInputRef={{ current: null }}
        room={{ participants: [] }}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(getByTestId('chat-message-input'), { target: { value: 'hello' } });
    fireEvent.click(getByTestId('chat-send-button'));

    await waitFor(() => expect(getByTestId('message-submission-status')).toHaveTextContent('waiting-for-message'));
    expect(getByTestId('chat-message-input')).toHaveValue('hello');

    confirmSubmit();
    await waitFor(() => expect(getByTestId('message-submission-status')).toHaveTextContent('complete'));
    expect(getByTestId('chat-message-input')).toHaveValue('');
  });
});
