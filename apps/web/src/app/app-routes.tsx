import { Route, Routes } from 'react-router';
import { AuthProvider } from '../features/auth/model/auth-context';
import { LoginPage, RegisterPage } from '../features/auth/ui/auth-pages';
import { HomePage } from '../pages/home/home-page';
import { NotFoundPage } from '../pages/not-found/not-found-page';
import { MemberProfilePage } from '../features/profile/ui/member-profile-page';
import { MemberLayout } from '../features/profile/ui/member-layout';
import { ProfilePage } from '../features/profile/ui/profile-page';
import { DiscoveryPage } from '../features/discovery/ui/discovery-page';
import { FriendsPage } from '../features/friendships/ui/friends-page';
import { FriendshipRequestsPage } from '../features/friendships/ui/friendship-requests-page';
import { FeedPage } from '../features/posts/ui/feed-page';
import { PostDetailPage } from '../features/posts/ui/post-detail-page';

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dang-nhap" element={<LoginPage />} />
        <Route path="/dang-ky" element={<RegisterPage />} />
        <Route path="/ho-so" element={<MemberLayout><ProfilePage /></MemberLayout>} />
        <Route path="/kham-pha" element={<MemberLayout><DiscoveryPage /></MemberLayout>} />
        <Route path="/ban-be" element={<MemberLayout><FriendsPage /></MemberLayout>} />
        <Route path="/ban-be/loi-moi" element={<MemberLayout><FriendshipRequestsPage /></MemberLayout>} />
        <Route path="/bang-tin" element={<MemberLayout><FeedPage /></MemberLayout>} />
        <Route path="/bai-viet/:postId" element={<MemberLayout><PostDetailPage /></MemberLayout>} />
        <Route path="/thanh-vien/:id" element={<MemberLayout><MemberProfilePage /></MemberLayout>} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
