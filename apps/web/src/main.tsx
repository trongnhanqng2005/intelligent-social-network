import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './app/styles/fonts.css';
import './app/styles/global.css';
import './shared/ui/ui.css';
import './features/auth/ui/auth.css';
import './pages/home/home-page.css';
import './features/profile/ui/profile.css';
import './features/posts/ui/feed.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
