import { Route, Routes } from 'react-router';
import { AuthProvider } from '../features/auth/model/auth-context';
import { LoginPage, RegisterPage } from '../features/auth/ui/auth-pages';
import { HomePage } from '../pages/home/home-page';
import { NotFoundPage } from '../pages/not-found/not-found-page';

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dang-nhap" element={<LoginPage />} />
        <Route path="/dang-ky" element={<RegisterPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
