import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  it('announces errors and status feedback using semantic live regions', () => {
    const { rerender } = render(<Alert tone="error">Không thể gửi biểu mẫu.</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Không thể gửi biểu mẫu.');

    rerender(<Alert tone="success">Đã tạo tài khoản.</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Đã tạo tài khoản.');
  });
});
