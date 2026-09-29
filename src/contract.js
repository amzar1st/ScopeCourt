import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

export const ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || '';
export const EXPLORER = 'https://explorer.genlayer.com';
const readClient = createClient({ chain: studionet });
let writeClient;
let wallet;

export function account() { return wallet; }
export async function connect() {
  if (!window.ethereum) throw new Error('Install a compatible EIP-1193 wallet to sign transactions.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  wallet = accounts[0];
  if (!wallet) throw new Error('No wallet account selected.');
  writeClient = createClient({ chain: studionet, account: wallet, provider: window.ethereum });
  await writeClient.connect('studionet');
  return wallet;
}
export function requireAddress() {
  if (!/^0x[a-fA-F0-9]{40}$/.test(ADDRESS)) throw new Error('Contract is not deployed yet. The interface is read-only until a verified address is configured.');
}
export async function read(functionName, args = []) {
  requireAddress();
  return readClient.readContract({
    address: ADDRESS, functionName, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL
  });
}
export async function write(functionName, args = [], value) {
  requireAddress();
  if (!writeClient) throw new Error('Connect your wallet first.');
  const request = { address: ADDRESS, functionName, args, value: value ?? 0n };
  const hash = await writeClient.writeContract(request);
  const receipt = await writeClient.waitForTransactionReceipt({ hash, status: 'FINALIZED' });
  if (receipt.statusName !== 'FINALIZED' || receipt.txExecutionResultName !== 'SUCCESS' || receipt.resultName !== 'SUCCESS') {
    throw new Error(`Transaction failed: ${receipt.statusName || receipt.status} / ${receipt.txExecutionResultName || receipt.resultName || 'execution failed'}`);
  }
  return hash;
}
