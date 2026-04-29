/**
 * deploy.ts — Deploy NightWork to Midnight Preprod
 *
 * Run:
 *   AGENT_SEED=<64-char hex> npm run deploy
 *
 * Prerequisites:
 *   1. npm install
 *   2. npm run compile
 *   3. npm run proof-server (or docker run ... in another terminal)
 */

import * as path  from 'node:path';
import { Buffer } from 'buffer';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider }  from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider }    from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider }  from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider }       from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { deployContract }             from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract }           from '@midnight-ntwrk/compact-js';
import { WalletFacade }               from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet }                 from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles }            from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet }             from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v7';

globalThis.WebSocket = WebSocket as any;
setNetworkId('preprod');

const CONFIG = {
  indexer:     'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS:   'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  proofServer: process.env.PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
  node:        'https://rpc.preprod.midnight.network',
};

const ZK_CONFIG_PATH = path.resolve(import.meta.dirname, '..', 'contracts', 'managed', 'night-work');

async function buildWallet(seed: string) {
  const hd = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hd.type !== 'seedOk') throw new Error('Invalid AGENT_SEED');
  const result = hd.hdWallet.selectAccount(0).selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust]).deriveKeysAt(0);
  if (result.type !== 'keysDerived') throw new Error('Key derivation failed');
  hd.hdWallet.clear();
  const keys = result.keys;
  const networkId   = getNetworkId();
  const shieldedSKs = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSK      = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore    = createKeystore(keys[Roles.NightExternal], networkId);
  const base = { networkId, indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS }, provingServerUrl: new URL(CONFIG.proofServer), relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')) };
  const shielded   = ShieldedWallet(base).startWithSecretKeys(shieldedSKs);
  const unshielded = UnshieldedWallet({ networkId, indexerClientConnection: base.indexerClientConnection, txHistoryStorage: new InMemoryTransactionHistoryStorage() }).startWithPublicKey(PublicKey.fromKeyStore(keystore));
  const dust = DustWallet({ ...base, costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 } }).startWithSecretKey(dustSK, ledger.LedgerParameters.initialParameters().dust);
  const wallet = new WalletFacade(shielded, unshielded, dust);
  await wallet.start(shieldedSKs, dustSK);
  return { wallet, shieldedSKs, dustSK, keystore };
}

async function main() {
  const seed = process.env.AGENT_SEED;
  if (!seed) throw new Error('Set AGENT_SEED env var (64-char hex)');

  console.log('\n🚀 Deploying NightWork to Midnight Preprod...\n');
  const ctx = await buildWallet(seed);
  console.log(`   Deployer: ${ctx.keystore.getBech32Address()}`);

  console.log('   Syncing wallet...');
  await Rx.firstValueFrom(ctx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));
  console.log('   ✅ Synced\n');

  const ContractModule = await import(path.join(ZK_CONFIG_PATH, 'contract', 'index.js'));
  const compiled = CompiledContract
    .make('night-work', ContractModule.Contract)
    .pipe(CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH));

  const providers = {
    publicDataProvider:   indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS),
    proofProvider:        httpClientProofProvider(CONFIG.proofServer, new NodeZkConfigProvider(ZK_CONFIG_PATH)),
    privateStateProvider: levelPrivateStateProvider({ privateStateStoreName: 'night-work-deploy', walletProvider: ctx.wallet as any }),
    walletProvider:   ctx.wallet as any,
    midnightProvider: ctx.wallet as any,
  };

  console.log('   Deploying contract (proof generation takes 1-2 min)...');
  const deployed = await deployContract(providers, { compiledContract: compiled, privateStateId: 'nightWorkState', initialPrivateState: {} });

  console.log(`\n   ✅ NightWork deployed!`);
  console.log(`   CONTRACT_ADDRESS=${deployed.deployTxData.public.contractAddress}`);
  console.log(`\n   Add to .env:\n   CONTRACT_ADDRESS=${deployed.deployTxData.public.contractAddress}`);
}

main().catch(console.error);
