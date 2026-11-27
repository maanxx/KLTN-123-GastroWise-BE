export class SafeUserResponseDto {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  designation?: string;
  bio?: string;
  picture?: string;
  role: string;
  status: string;
  preferences: string[];
  savedRestaurants: any[];
  isTwoFactorEnabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export function toSafeUser(user: any): SafeUserResponseDto {
  if (!user) return user;
  const raw = user.toObject ? user.toObject() : { ...user };
  delete raw.password;
  delete raw.hashedRefreshToken;
  delete raw.twoFactorSecret;
  delete raw.resetOtp;
  delete raw.__v;
  if (raw._id) {
    raw.id = raw._id.toString();
    delete raw._id;
  }
  return raw as SafeUserResponseDto;
}
