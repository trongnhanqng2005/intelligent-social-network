import { HttpStatus } from '@nestjs/common';
import { UpdateOwnProfileDto } from './users.dto.js';
import { ProfileException } from './users.errors.js';
import { UsersService } from './users.service.js';

const own = {
  id: 'd723b01f-7048-4efd-80c7-2d59cfb88319',
  displayName: 'Nguyễn An',
  bio: null,
  location: null,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:00.000Z',
  version: 0,
};
const other = { id: 'f4ce1c82-8f40-49aa-82c8-f0515878888a', displayName: 'Đặng Bình', bio: null, location: null };

describe('UsersService', () => {
  const repository = {
    findOwnProfile: jest.fn(),
    findPublicProfile: jest.fn(),
    listPublicProfiles: jest.fn(),
    updateProfile: jest.fn(),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(repository as never);
    repository.findOwnProfile.mockResolvedValue(own);
    repository.findPublicProfile.mockResolvedValue(other);
    repository.listPublicProfiles.mockResolvedValue([other]);
    repository.updateProfile.mockResolvedValue({ status: 'updated', profile: { ...own, version: 1 } });
  });

  it('loads the own profile using only the principal identity', async () => {
    await expect(service.getOwnProfile(own.id)).resolves.toEqual({ profile: own });
    expect(repository.findOwnProfile).toHaveBeenCalledWith(own.id);
  });

  it('updates only allowlisted fields and normalizes display name before persistence', async () => {
    await service.updateOwnProfile(own.id, {
      displayName: '  Đặng   Bình  ', expectedVersion: 0,
    });
    expect(repository.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      userId: own.id,
      displayName: 'Đặng Bình',
      displayNameSearch: 'dang binh',
      expectedVersion: 0,
    }));
  });

  it('treats omitted optional fields on a transformed DTO as omitted, not as clears', async () => {
    const dto = Object.assign(new UpdateOwnProfileDto(), { displayName: 'Tên mới', expectedVersion: 0 });
    await service.updateOwnProfile(own.id, dto);
    expect(repository.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Tên mới', expectedVersion: 0,
    }));
    expect(repository.updateProfile).toHaveBeenCalledWith(expect.not.objectContaining({ bio: undefined, location: undefined }));
  });

  it('rejects target IDs and empty updates instead of trusting extra input', async () => {
    await expect(service.updateOwnProfile(own.id, { expectedVersion: 0, id: other.id } as never)
      .then(() => undefined)).rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    await expect(service.updateOwnProfile(own.id, { expectedVersion: 0 } as never))
      .rejects.toMatchObject({ status: HttpStatus.UNPROCESSABLE_ENTITY });
    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  it('maps a stale write to PROFILE_CONFLICT without retrying', async () => {
    repository.updateProfile.mockResolvedValueOnce({ status: 'conflict' });
    await expect(service.updateOwnProfile(own.id, { bio: 'about', expectedVersion: 0 }))
      .rejects.toBeInstanceOf(ProfileException);
    try {
      await service.updateOwnProfile(own.id, { bio: 'about', expectedVersion: 0 });
    } catch (error) {
      expect(error).toMatchObject({ status: HttpStatus.CONFLICT });
    }
    expect(repository.updateProfile).toHaveBeenCalledTimes(2);
  });

  it('normalizes search and returns one bounded UUID-keyset page', async () => {
    repository.listPublicProfiles.mockResolvedValueOnce([other, { ...other, id: 'a4ce1c82-8f40-49aa-82c8-f0515878888a' }]);
    const result = await service.listMembers(own.id, { q: 'ĐẶNG', limit: 1 });
    expect(repository.listPublicProfiles).toHaveBeenCalledWith(expect.objectContaining({
      userId: own.id, query: 'dang', fetchLimit: 2,
    }));
    expect(result.items).toEqual([other]);
    expect(result.pagination).toMatchObject({ limit: 1, hasMore: true });
    expect(result.pagination.nextCursor).toEqual(expect.any(String));
  });
});
