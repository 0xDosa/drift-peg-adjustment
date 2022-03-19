import {
	calculateMarkPrice,
	ClearingHouse, convertToNumber, DriftEnv, initialize,
	Markets, MARK_PRICE_PRECISION, Wallet
} from '@drift-labs/sdk';
import { BN, Provider } from '@project-serum/anchor';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const driftHelpers = require('./driftHelpers');

require('dotenv').config();

export const getTokenAddress = (
	mintAddress: string,
	userPubKey: string
): Promise<PublicKey> => {
	return Token.getAssociatedTokenAddress(
		new PublicKey(`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`),
		TOKEN_PROGRAM_ID,
		new PublicKey(mintAddress),
		new PublicKey(userPubKey)
	);
};

const main = async () => {
	// Initialize Drift SDK
	const sdkConfig = initialize({ env: 'mainnet-beta' as DriftEnv });

	// Set up the Wallet and Provider
	const privateKey = process.env.BOT_PRIVATE_KEY; // stored as an array string
	const keypair = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(privateKey))
	);
	const wallet = new Wallet(keypair);

	// Set up the Connection
	const rpcAddress = 'https://api.mainnet-beta.solana.com'//'https://api.devnet.solana.com'// for devnet; https://api.mainnet-beta.solana.com for mainnet;
	const connection = new Connection(rpcAddress);

	// Set up the Provider
	const provider = new Provider(connection, wallet, Provider.defaultOptions());

	// Check SOL Balance
	const lamportsBalance = await connection.getBalance(wallet.publicKey);

	// Misc. other things to set up
	const usdcTokenAddress = await getTokenAddress(
		sdkConfig.USDC_MINT_ADDRESS,
		wallet.publicKey.toString()
	);

	// Set up the Drift Clearing House
	const clearingHousePublicKey = new PublicKey(
		sdkConfig.CLEARING_HOUSE_PROGRAM_ID
	);
	const clearingHouse = ClearingHouse.from(
		connection,
		provider.wallet,
		clearingHousePublicKey
	);
	await clearingHouse.subscribe();



	// Get current price
	const solMarketInfo = Markets.find(
		(market) => market.baseAssetSymbol === 'SOL'
	);

	// Estimate the slippage for a $5000 LONG trade
	const solMarketAccount = clearingHouse.getMarket(solMarketInfo.marketIndex);

	// set new peg scaled by 1e3
	driftHelpers.calculateRepegCost(solMarketAccount,solMarketInfo.marketIndex,new BN(200000));

};

main();