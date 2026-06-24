'use client';

/**
 * Onboarding de carteira não-custodial (ADR 0007) — assinatura CLIENT-SIDE.
 *
 * O ponto do não-custodial: a master key nasce/assina no NAVEGADOR do usuário.
 * No modo GENERATED, geramos a keypair localmente (Keypair.random) — a secret
 * NUNCA é enviada ao servidor; só a pubkey vai à API. O usuário faz backup.
 * No modo EXTERNAL, o usuário conecta a própria wallet via Stellar Wallets Kit
 * (Freighter, xBull, Albedo, Rabet, Hana, LOBSTR…) e assina o setup direto pela
 * wallet — sem colar XDR à mão. Mantém um fallback de colar o XDR assinado.
 *
 * Fluxo: createWallet → buildWalletSetup → (dono assina) → submitWalletSetup.
 */

import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import { useRef, useState } from 'react';

import {
  buildWalletSetup,
  createWallet,
  submitWalletSetup,
  type OwnerKeyMode,
} from '@/lib/wallet-actions';
import type { Agent } from '@/lib/types';

type Phase =
  | 'form'
  | 'backup' // GENERATED: mostra a secret p/ backup
  | 'await-external-sign' // EXTERNAL: mostra o XDR p/ assinar fora
  | 'working'
  | 'done'
  | 'error';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function WalletOnboarding({ agents }: { agents: Agent[] }) {
  // Agentes elegíveis: ativos e ainda sem carteira.
  const eligible = agents.filter((a) => a.status === 'ACTIVE' && !a.walletId);

  const [phase, setPhase] = useState<Phase>('form');
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<OwnerKeyMode>('GENERATED');
  const [externalAddress, setExternalAddress] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  // Estado transitório do fluxo
  const [genSecret, setGenSecret] = useState(''); // master secret (GENERATED) — só no browser
  const [genPubKey, setGenPubKey] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [walletId, setWalletId] = useState('');
  const [setupXdr, setSetupXdr] = useState('');
  const [networkPassphrase, setNetworkPassphrase] = useState('');
  const [pastedSignedXdr, setPastedSignedXdr] = useState('');
  const [resultTxHash, setResultTxHash] = useState('');

  // EXTERNAL via Stellar Wallets Kit (Freighter/xBull/Albedo/…)
  const [walletConnected, setWalletConnected] = useState(false);
  const kitReady = useRef(false);

  /** Carrega + inicializa o kit (uma vez) via dynamic import (client-only, evita SSR).
   *  Os módulos de wallet vivem em subpaths (`/modules/*`), não no barrel principal. */
  async function loadKit() {
    const [core, freighter, xbull, albedo, rabet, hana, lobstr] = await Promise.all([
      import('@creit.tech/stellar-wallets-kit'),
      import('@creit.tech/stellar-wallets-kit/modules/freighter'),
      import('@creit.tech/stellar-wallets-kit/modules/xbull'),
      import('@creit.tech/stellar-wallets-kit/modules/albedo'),
      import('@creit.tech/stellar-wallets-kit/modules/rabet'),
      import('@creit.tech/stellar-wallets-kit/modules/hana'),
      import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
    ]);
    if (!kitReady.current) {
      core.StellarWalletsKit.init({
        network: core.Networks.TESTNET,
        selectedWalletId: freighter.FREIGHTER_ID,
        modules: [
          new freighter.FreighterModule(),
          new xbull.xBullModule(),
          new albedo.AlbedoModule(),
          new rabet.RabetModule(),
          new hana.HanaModule(),
          new lobstr.LobstrModule(),
        ],
      });
      kitReady.current = true;
    }
    return core.StellarWalletsKit;
  }

  /** Abre o modal de seleção de wallet e preenche o endereço conectado. */
  async function connectWallet() {
    setError('');
    try {
      const kit = await loadKit();
      const { address } = await kit.authModal();
      setExternalAddress(address);
      setWalletConnected(true);
    } catch (e) {
      setError('Conexão cancelada / falhou: ' + errMsg(e));
    }
  }

  /** Assina o XDR de setup pela wallet conectada. */
  async function signWithConnectedWallet(xdr: string, passphrase: string): Promise<string> {
    const kit = await loadKit();
    const { signedTxXdr } = await kit.signTransaction(xdr, {
      networkPassphrase: passphrase,
      address: externalAddress,
    });
    return signedTxXdr;
  }

  function reset() {
    setPhase('form');
    setLabel('');
    setMode('GENERATED');
    setExternalAddress('');
    setAgentIds([]);
    setError('');
    setGenSecret('');
    setGenPubKey('');
    setBackupConfirmed(false);
    setWalletId('');
    setSetupXdr('');
    setNetworkPassphrase('');
    setPastedSignedXdr('');
    setResultTxHash('');
    setWalletConnected(false);
  }

  function toggleAgent(id: string) {
    setAgentIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  // ---- Passo 1: validar form e (GENERATED) gerar keypair ----
  function onStart() {
    setError('');
    if (!label.trim()) return setError('Informe um nome para a carteira.');
    if (agentIds.length === 0) return setError('Selecione ao menos um agente.');

    if (mode === 'GENERATED') {
      const kp = Keypair.random();
      setGenSecret(kp.secret());
      setGenPubKey(kp.publicKey());
      setPhase('backup');
    } else {
      if (!/^G[A-Z2-7]{55}$/.test(externalAddress.trim())) {
        return setError('Endereço Stellar inválido (G... 56 chars).');
      }
      void provision(externalAddress.trim(), null);
    }
  }

  // ---- Passo 2: cria carteira + monta setup (e, GENERATED, assina e submete) ----
  async function provision(address: string, masterSecret: string | null) {
    setPhase('working');
    setError('');
    try {
      const wallet = await createWallet({ label: label.trim(), ownerKeyMode: mode, address, agentIds });
      setWalletId(wallet.id);

      const setup = await buildWalletSetup(wallet.id);
      setSetupXdr(setup.setupXdr);
      setNetworkPassphrase(setup.networkPassphrase);

      if (masterSecret) {
        // GENERATED: assina no browser com a master gerada e submete.
        const signed = signXdr(setup.setupXdr, setup.networkPassphrase, masterSecret);
        const done = await submitWalletSetup(wallet.id, signed);
        setResultTxHash(done.setupTxHash ?? '');
        setPhase('done');
      } else if (walletConnected) {
        // EXTERNAL conectado: assina pela wallet (Freighter/xBull/…) e submete.
        const signed = await signWithConnectedWallet(setup.setupXdr, setup.networkPassphrase);
        const done = await submitWalletSetup(wallet.id, signed);
        setResultTxHash(done.setupTxHash ?? '');
        setPhase('done');
      } else {
        // EXTERNAL fallback: usuário assina fora (Lab) e cola o XDR.
        setPhase('await-external-sign');
      }
    } catch (e) {
      setError(errMsg(e));
      setPhase('error');
    }
  }

  // ---- EXTERNAL: submeter o XDR assinado colado ----
  async function submitExternal() {
    setError('');
    if (!pastedSignedXdr.trim()) return setError('Cole o XDR assinado.');
    setPhase('working');
    try {
      const done = await submitWalletSetup(walletId, pastedSignedXdr.trim());
      setResultTxHash(done.setupTxHash ?? '');
      setPhase('done');
    } catch (e) {
      setError(errMsg(e));
      setPhase('error');
    }
  }

  function signXdr(xdr: string, passphrase: string, secret: string): string {
    const tx = TransactionBuilder.fromXDR(xdr, passphrase);
    tx.sign(Keypair.fromSecret(secret));
    return tx.toXDR();
  }

  // ============================ RENDER ============================
  const box = 'rounded-lg border border-slate-700 bg-slate-900/40 p-4';
  const input =
    'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-accent focus:outline-none';
  const btn =
    'rounded-md bg-accent px-4 py-2 text-sm font-medium text-slate-950 hover:bg-accent/90 disabled:opacity-50';
  const btnSubtle = 'rounded-md border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800';

  if (phase === 'done') {
    return (
      <div className={box}>
        <p className="text-sm font-medium text-emerald-400">✅ Carteira ativada (multisig configurado on-chain).</p>
        {resultTxHash && (
          <p className="mt-1 break-all text-xs text-slate-400">setup tx: {resultTxHash}</p>
        )}
        <button className={`${btnSubtle} mt-3`} onClick={reset}>
          Criar outra carteira
        </button>
      </div>
    );
  }

  if (phase === 'backup') {
    return (
      <div className={box}>
        <p className="text-sm font-medium text-amber-300">⚠️ Faça backup da chave da sua carteira</p>
        <p className="mt-1 text-xs text-slate-400">
          Esta secret é a <strong>master key</strong> (recuperação total). O Aegis NUNCA a vê — ela
          existe só neste navegador. Guarde-a com segurança; sem ela você perde o controle de recuperação.
        </p>
        <div className="mt-3 space-y-2">
          <div>
            <span className="text-xs text-slate-500">Public key (endereço)</span>
            <code className="block break-all rounded bg-slate-950 p-2 text-xs text-slate-300">{genPubKey}</code>
          </div>
          <div>
            <span className="text-xs text-slate-500">Secret key (BACKUP)</span>
            <code className="block break-all rounded bg-slate-950 p-2 text-xs text-amber-300">{genSecret}</code>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={backupConfirmed}
            onChange={(e) => setBackupConfirmed(e.target.checked)}
          />
          Guardei a secret key em local seguro.
        </label>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button
            className={btn}
            disabled={!backupConfirmed}
            onClick={() => void provision(genPubKey, genSecret)}
          >
            Criar e ativar carteira
          </button>
          <button className={btnSubtle} onClick={reset}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'await-external-sign') {
    return (
      <div className={box}>
        <p className="text-sm font-medium text-slate-200">Assine a transação de setup</p>
        <p className="mt-1 text-xs text-slate-400">
          Assine este XDR com sua wallet (Freighter / Stellar Lab) usando a master key de{' '}
          <code className="text-slate-300">{externalAddress.slice(0, 8)}…</code> e cole o XDR assinado abaixo.
          Passphrase: <code className="text-slate-300">{networkPassphrase}</code>
        </p>
        <textarea
          className={`${input} mt-2 h-24 font-mono text-xs`}
          readOnly
          value={setupXdr}
          onFocus={(e) => e.currentTarget.select()}
        />
        <textarea
          className={`${input} mt-2 h-24 font-mono text-xs`}
          placeholder="Cole aqui o XDR assinado…"
          value={pastedSignedXdr}
          onChange={(e) => setPastedSignedXdr(e.target.value)}
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button className={btn} onClick={() => void submitExternal()}>
            Submeter setup
          </button>
          <button className={btnSubtle} onClick={reset}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'working') {
    return (
      <div className={box}>
        <p className="text-sm text-slate-300">Processando… (criando carteira, montando e submetendo o setup multisig)</p>
      </div>
    );
  }

  // phase === 'form' | 'error'
  return (
    <div className={box}>
      {eligible.length === 0 ? (
        <p className="text-xs text-amber-300">
          Crie ao menos um agente ATIVO sem carteira antes de provisionar uma carteira (os agentes
          viram signers da conta multisig).
        </p>
      ) : (
        <div className="space-y-3">
          <div>
            <span className="text-xs text-slate-500">Nome / centro de custo</span>
            <input
              className={input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="marketing, devops…"
            />
          </div>

          <div>
            <span className="text-xs text-slate-500">Origem da master key</span>
            <div className="mt-1 flex gap-4 text-sm text-slate-200">
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === 'GENERATED'} onChange={() => setMode('GENERATED')} />
                Aegis gera (client-side)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mode === 'EXTERNAL'} onChange={() => setMode('EXTERNAL')} />
                Trazer minha wallet
              </label>
            </div>
          </div>

          {mode === 'EXTERNAL' && (
            <div className="space-y-2">
              <span className="text-xs text-slate-500">Sua wallet (Freighter, xBull, Albedo, Rabet, Hana, LOBSTR…)</span>
              <div className="flex items-center gap-2">
                <button type="button" className={btnSubtle} onClick={() => void connectWallet()}>
                  {walletConnected ? '✓ Conectada — trocar' : 'Conectar carteira'}
                </button>
                {walletConnected && (
                  <span className="text-xs text-emerald-400">
                    {externalAddress.slice(0, 6)}…{externalAddress.slice(-4)} — vai assinar pela wallet
                  </span>
                )}
              </div>
              <span className="text-[11px] text-slate-500">
                ou cole o endereço manualmente (aí você assina o XDR fora e cola de volta):
              </span>
              <input
                className={input}
                value={externalAddress}
                onChange={(e) => {
                  setExternalAddress(e.target.value);
                  setWalletConnected(false);
                }}
                placeholder="G…"
              />
            </div>
          )}

          <div>
            <span className="text-xs text-slate-500">Agentes desta carteira (signers)</span>
            <div className="mt-1 space-y-1">
              {eligible.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={agentIds.includes(a.id)}
                    onChange={() => toggleAgent(a.id)}
                  />
                  {a.name}
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button className={btn} onClick={onStart}>
            {mode === 'GENERATED' ? 'Gerar carteira' : 'Provisionar carteira'}
          </button>
        </div>
      )}
    </div>
  );
}
