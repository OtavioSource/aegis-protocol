export default function HomePage() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '4rem 2rem', maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Aegis Protocol</h1>
      <p style={{ fontSize: '1.125rem', color: '#444' }}>
        Camada de governança econômica para agentes de IA que pagam autonomamente via Stellar.
      </p>
      <p style={{ marginTop: '2rem', fontSize: '0.9rem', color: '#888' }}>
        Dashboard em construção. Veja a documentação em <code>docs/</code> no repositório.
      </p>
    </main>
  );
}
