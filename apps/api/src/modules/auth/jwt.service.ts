import { createPrivateKey, createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { resolveAuthPath } from './auth-path.js';

const SESSION_TTL_SECONDS = 86_400;

export type SessionClaims = JWTPayload & { sub: string; jti: string; iat: number; exp: number };

@Injectable()
export class JwtService implements OnModuleInit {
  private privateKey!: Awaited<ReturnType<typeof importPKCS8>>;
  private publicKey!: Awaited<ReturnType<typeof importSPKI>>;
  private readonly keyId: string;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(config: ConfigService) {
    this.privateKeyPath = resolveAuthPath(config.getOrThrow<string>('AUTH_PRIVATE_KEY_PATH'));
    this.publicKeyPath = resolveAuthPath(config.getOrThrow<string>('AUTH_PUBLIC_KEY_PATH'));
    this.keyId = config.getOrThrow<string>('AUTH_KEY_ID');
    this.issuer = config.getOrThrow<string>('AUTH_ISSUER');
    this.audience = config.getOrThrow<string>('AUTH_AUDIENCE');
  }

  private readonly privateKeyPath: string;
  private readonly publicKeyPath: string;

  async onModuleInit(): Promise<void> {
    const [privatePem, publicPem] = await Promise.all([
      readFile(this.privateKeyPath, 'utf8'),
      readFile(this.publicKeyPath, 'utf8'),
    ]);
    const privateKey = createPrivateKey(privatePem);
    const publicKey = createPublicKey(publicPem);
    if (privateKey.asymmetricKeyType !== 'rsa' ||
        (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072 ||
        publicKey.asymmetricKeyType !== 'rsa' ||
        (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
      throw new Error('Authentication signing keys must be RSA-3072 or stronger');
    }
    const derivedPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const configuredPublic = publicKey.export({ type: 'spki', format: 'der' });
    if (!derivedPublic.equals(configuredPublic)) throw new Error('Authentication signing key pair does not match');
    this.privateKey = await importPKCS8(privatePem, 'RS256');
    this.publicKey = await importSPKI(publicPem, 'RS256');
  }

  async signSession(userId: string, jti: string, issuedAt = Math.floor(Date.now() / 1000)): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: this.keyId })
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + SESSION_TTL_SECONDS)
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .sign(this.privateKey);
  }

  async verifySessionToken(token: string): Promise<SessionClaims> {
    const { payload, protectedHeader } = await jwtVerify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer: this.issuer,
      audience: this.audience,
      maxTokenAge: SESSION_TTL_SECONDS,
      clockTolerance: 5,
      typ: 'JWT',
    });
    if (protectedHeader.kid !== this.keyId || typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string' || typeof payload.iat !== 'number' ||
        typeof payload.exp !== 'number' || payload.exp - payload.iat !== SESSION_TTL_SECONDS) {
      throw new Error('Invalid authentication session token');
    }
    return payload as SessionClaims;
  }
}
