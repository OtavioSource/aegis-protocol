import 'next-auth';
import 'next-auth/jwt';

/** Campos extras carregados do /v1/auth/login e propagados no JWT/Session. */
interface AegisProfile {
  role: string;
  companyId: string;
  companyName: string | null;
}

declare module 'next-auth' {
  interface User extends AegisProfile {
    id: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
    } & AegisProfile;
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends AegisProfile {}
}
