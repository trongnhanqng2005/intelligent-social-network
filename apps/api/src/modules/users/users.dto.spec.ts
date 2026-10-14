import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateOwnProfileDto, UserIdParamsDto, UsersQueryDto } from './users.dto.js';

describe('Users DTOs', () => {
  it('accepts explicit null for optional fields but requires safe integer versions', async () => {
    const dto = plainToInstance(UpdateOwnProfileDto, {
      bio: null,
      location: 'Đà Nẵng',
      expectedVersion: 0,
    });
    expect(await validate(dto)).toHaveLength(0);
    const invalid = plainToInstance(UpdateOwnProfileDto, { displayName: null, expectedVersion: -1 });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('rejects unknown update fields under the API whitelist policy', async () => {
    const dto = plainToInstance(UpdateOwnProfileDto, {
      displayName: 'An', expectedVersion: 0, passwordHash: 'private',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map(({ property }) => property)).toContain('passwordHash');
  });

  it('parses only bounded decimal directory limits and validates UUID parameters', async () => {
    const query = plainToInstance(UsersQueryDto, { limit: '50', q: 'Nguyễn', cursor: 'abc' });
    expect(query.limit).toBe(50);
    expect(await validate(query)).toHaveLength(0);
    const invalidQuery = plainToInstance(UsersQueryDto, { limit: '1e4' });
    expect(await validate(invalidQuery)).not.toHaveLength(0);
    const invalidId = plainToInstance(UserIdParamsDto, { id: 'internal-id' });
    expect(await validate(invalidId)).not.toHaveLength(0);
  });
});
