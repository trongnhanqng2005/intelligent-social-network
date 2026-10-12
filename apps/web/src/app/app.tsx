import { BrowserRouter } from 'react-router';
import { AppRoutes } from './app-routes';

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
