import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';

describe('bcrypt hashing and comparison', () => {
  it('should hash and successfully compare the password', async () => {
    const password = 'mysecurepassword';
    const saltRounds = 10;

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    expect(typeof hashedPassword).toBe('string');
    expect(hashedPassword).not.toBe(password);

    const isMatch = await bcrypt.compare(password, hashedPassword);
    expect(isMatch).toBe(true);
  });

  it('should fail comparison with incorrect password', async () => {
    const password = 'correctpassword';
    const wrongPassword = 'wrongpassword';
    const saltRounds = 10;

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const isMatch = await bcrypt.compare(wrongPassword, hashedPassword);
    expect(isMatch).toBe(false);
  });
});
