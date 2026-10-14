export interface PublicProfile {
  id: string;
  displayName: string;
  bio: string | null;
  location: string | null;
}

export interface OwnProfile extends PublicProfile {
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProfileUpdate {
  userId: string;
  expectedVersion: number;
  displayName?: string;
  bio?: string | null;
  location?: string | null;
  displayNameSearch?: string;
  updatedAt: string;
}

export type ProfileUpdateResult =
  | { status: 'updated'; profile: OwnProfile }
  | { status: 'not-found' }
  | { status: 'conflict' };
