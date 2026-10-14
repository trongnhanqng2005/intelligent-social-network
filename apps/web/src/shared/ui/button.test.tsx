import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('exposes native disabled and pending states accessibly', () => {
    render(<Button pending pendingLabel="Đang xử lý">Tạo tài khoản</Button>);

    expect(screen.getByRole('button', { name: 'Đang xử lý' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Đang xử lý');
  });

  it('supports secondary and ghost variants', () => {
    const { rerender } = render(<Button variant="secondary">Tiếp tục</Button>);
    expect(screen.getByRole('button')).toHaveClass('ui-button--secondary');

    rerender(<Button variant="ghost">Quay lại</Button>);
    expect(screen.getByRole('button')).toHaveClass('ui-button--ghost');
  });
});
