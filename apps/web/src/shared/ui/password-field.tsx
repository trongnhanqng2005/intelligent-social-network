import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string;
  required?: boolean;
}

export function PasswordField({ id, label, value, onChange, autoComplete, hint, error, required = true }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <div className={`input-wrap ${error ? 'input-wrap--invalid' : ''}`}>
        <KeyRound aria-hidden="true" size={19} />
        <input
          autoComplete={autoComplete}
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={[error ? errorId : '', hint ? hintId : ''].filter(Boolean).join(' ') || undefined}
          placeholder={label}
        />
        <button className="password-toggle" type="button" onClick={() => setVisible((shown) => !shown)} aria-label={visible ? `Ẩn ${label.toLowerCase()}` : `Hiện ${label.toLowerCase()}`} aria-pressed={visible}>
          {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        </button>
      </div>
      {error && <p className="field-error" id={errorId}>{error}</p>}
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
    </div>
  );
}
