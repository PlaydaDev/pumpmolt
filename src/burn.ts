/**
 * Token Burn module for Pump.fun Skill
 * Handles permanently destroying SPL tokens from the wallet
 */

import {
  PublicKey,
  Transaction,
  TransactionSignature,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createBurnInstruction,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { getConfig } from './config.js';
import {
  getKeypairFromPrivateKey,
  getConnection,
  isValidSolanaAddress,
  formatTransactionUrl,
  safeExecute,
  OperationResult,
} from './utils.js';

/** The only mint address allowed for burning */
const POLT_MINT = 'HAb2yhWzYqAnbfMg2rJQoeWCZCaNuQWwLj8ZB8iSuxuP';

export interface BurnParams {
  mint: string;
  amount: number | string;
  priorityFee?: number;
}

export interface BurnResult {
  signature: TransactionSignature;
  explorerUrl: string;
  mint: string;
  amountBurned: string;
}

/**
 * Executes a token burn on Solana
 */
async function executeBurn(params: BurnParams): Promise<BurnResult> {
  const config = getConfig();

  // Validate mint address
  if (!isValidSolanaAddress(params.mint)) {
    throw new Error(`Invalid token mint address: ${params.mint}`);
  }

  // Only allow burning $POLT tokens
  if (params.mint !== POLT_MINT) {
    throw new Error(`Burning is only allowed for $POLT token (${POLT_MINT}). Got: ${params.mint}`);
  }

  const keypair = getKeypairFromPrivateKey(config.privateKey);
  const connection = getConnection();
  const mintPubkey = new PublicKey(params.mint);

  // Derive the Associated Token Account (using Token-2022 program for $POLT)
  const ata = await getAssociatedTokenAddress(
    mintPubkey,
    keypair.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  // Fetch the token account to get balance and decimals
  const tokenAccount = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
  const mintInfo = await connection.getParsedAccountInfo(mintPubkey);

  if (!mintInfo.value) {
    throw new Error(`Could not fetch mint info for: ${params.mint}`);
  }

  const parsedData = (mintInfo.value.data as any).parsed;
  const decimals: number = parsedData.info.decimals;
  const currentBalance = tokenAccount.amount; // bigint in raw units

  // Calculate burn amount
  let burnAmount: bigint;
  let displayAmount: string;

  if (typeof params.amount === 'string' && params.amount.includes('%')) {
    const pctStr = params.amount.replace('%', '');
    const pct = parseFloat(pctStr);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      throw new Error(`Invalid percentage: ${params.amount}. Must be between 0 and 100.`);
    }
    // Calculate percentage of current balance
    burnAmount = BigInt(Math.floor(Number(currentBalance) * (pct / 100)));
    displayAmount = `${params.amount} (${burnAmount} raw tokens)`;
  } else {
    const numericAmount = typeof params.amount === 'string'
      ? parseFloat(params.amount)
      : params.amount;

    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error(`Invalid burn amount: ${params.amount}`);
    }

    burnAmount = BigInt(Math.round(numericAmount * Math.pow(10, decimals)));
    displayAmount = `${numericAmount} tokens`;
  }

  if (burnAmount <= 0n) {
    throw new Error('Burn amount must be greater than zero');
  }

  if (burnAmount > currentBalance) {
    const balanceFormatted = Number(currentBalance) / Math.pow(10, decimals);
    throw new Error(
      `Insufficient token balance. Requested: ${burnAmount}, Available: ${currentBalance} (${balanceFormatted} tokens)`
    );
  }

  console.log('Preparing burn transaction...');
  console.log(`  Mint: ${params.mint}`);
  console.log(`  Amount: ${displayAmount}`);
  console.log(`  Token Account: ${ata.toBase58()}`);

  // Build the transaction
  const transaction = new Transaction();

  // Add priority fee
  const priorityFee = params.priorityFee ?? config.priorityFee;
  const microLamports = Math.round(priorityFee * 1e9 * 1e6 / 200_000); // convert SOL to microLamports per CU
  transaction.add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports })
  );

  // Add burn instruction (using Token-2022 program for $POLT)
  transaction.add(
    createBurnInstruction(
      ata,                   // token account
      mintPubkey,            // mint
      keypair.publicKey,     // owner
      burnAmount,            // amount in raw units
      [],                    // multisigners
      TOKEN_2022_PROGRAM_ID  // Token-2022 program
    )
  );

  // Get recent blockhash and sign
  const latestBlockhash = await connection.getLatestBlockhash();
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.feePayer = keypair.publicKey;
  transaction.sign(keypair);

  console.log('Transaction built, sending...');

  // Send and confirm
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });

  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });

  console.log('Burn confirmed!');
  console.log(`  Signature: ${signature}`);

  return {
    signature,
    explorerUrl: formatTransactionUrl(signature),
    mint: params.mint,
    amountBurned: displayAmount,
  };
}

/**
 * Burn (permanently destroy) tokens from your wallet
 *
 * @param mint - Token mint address
 * @param amount - Amount of tokens to burn (number) or percentage string (e.g., "50%", "100%")
 * @param options - Optional parameters (priorityFee)
 */
export async function burnTokens(
  mint: string,
  amount: number | string,
  options: { priorityFee?: number } = {}
): Promise<OperationResult<BurnResult>> {
  return safeExecute(
    () => executeBurn({
      mint,
      amount,
      ...options,
    }),
    'Burn tokens'
  );
}
