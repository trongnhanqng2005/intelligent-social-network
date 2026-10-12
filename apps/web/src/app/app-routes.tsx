import { Route, Routes } from 'react-router';
import { HomePage } from '../pages/home/home-page';
import { NotFoundPage } from '../pages/not-found/not-found-page';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
