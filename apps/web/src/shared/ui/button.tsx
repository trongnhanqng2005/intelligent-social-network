import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  pending?: boolean;
  pendingLabel?: string;
  children: ReactNode;
};

export function Button({
  variant = 'primary',
  pending = false,
  pendingLabel = 'Đang xử lý…',
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const classes = ['ui-button', `ui-button--${variant}`, className].filter(Boolean).join(' ');

  return (
    <button {...props} className={classes} disabled={disabled || pending} aria-busy={pending || undefined} aria-label={pending ? pendingLabel : props['aria-label']}>
      {pending ? <><span className="ui-button__spinner" aria-hidden="true" />{pendingLabel}<span className="visually-hidden" role="status">{pendingLabel}</span></> : children}
    </button>
  );
}
