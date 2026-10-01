import type { McpScope } from "@/lib/oauth/config";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  kind: "cimd" | "dcr";
}

export interface NewAuthRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  expiresAt: string;
}

export interface AuthRequest extends NewAuthRequest {
  id: string;
  familyId: string | null;
  grantedScopes: McpScope[] | null;
  codeExpiresAt: string | null;
  usedAt: string | null;
  grantId: string | null;
}

export type ConsumeResult =
  | { status: "ok"; request: AuthRequest }
  | { status: "reused"; grantId: string | null }
  | { status: "missing" };

export interface NewGrant {
  familyId: string;
  name: string;
  scopes: McpScope[];
  oauthClientId: string;
  resource: string;
  accessHash: string;
  accessExpiresAt: string;
  refreshHash: string;
  refreshExpiresAt: string;
}

export interface GrantRecord {
  id: string;
  familyId: string;
  scopes: McpScope[];
  oauthClientId: string;
  resource: string;
  refreshExpiresAt: string;
  revokedAt: string | null;
}

export interface RotatedTokens {
  accessHash: string;
  accessExpiresAt: string;
  refreshHash: string;
  refreshExpiresAt: string;
}

/** Everything the grant logic needs from storage — injected so it can be tested without a database. */
export interface OAuthStore {
  createAuthRequest(request: NewAuthRequest): Promise<string>;
  getAuthRequest(id: string): Promise<AuthRequest | null>;
  /** Only a pending, unexpired request can be approved; false otherwise. */
  approveAuthRequest(id: string, familyId: string, granted: McpScope[], codeHash: string, codeExpiresAt: string, now: Date): Promise<boolean>;
  denyAuthRequest(id: string, now: Date): Promise<void>;
  /** Atomically marks the code used. A second presentation reports `reused`. */
  consumeCode(codeHash: string, now: Date): Promise<ConsumeResult>;
  insertGrant(grant: NewGrant): Promise<string>;
  linkGrant(requestId: string, grantId: string): Promise<void>;
  findGrantByRefreshHash(refreshHash: string): Promise<GrantRecord | null>;
  /** Compare-and-swap on the old refresh hash, so a replayed refresh token loses. */
  rotateGrant(id: string, oldRefreshHash: string, next: RotatedTokens): Promise<boolean>;
  revokeGrant(id: string, now: Date): Promise<void>;
}
