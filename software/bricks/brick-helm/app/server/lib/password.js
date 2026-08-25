import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain) {
  const value = String(plain || '');
  if (!value) {
    const err = new Error('Mot de passe requis');
    err.code = 'VALIDATION';
    throw err;
  }
  return bcrypt.hash(value, ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(String(plain), String(hash));
  } catch {
    return false;
  }
}
