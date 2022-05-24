import {
	calculateMarkPrice,
	calculateMaxBaseAssetAmountToTrade,
	calculateNewMarketAfterTrade,
	calculatePositionPNL,
	calculateQuoteAssetAmountSwapped,
	calculateTradeAcquiredAmounts,
	ClearingHouse, convertToNumber, DriftEnv, initialize,
	Markets, MARK_PRICE_PRECISION, PositionDirection, Wallet
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
	
	//Market to run the simulation for
	const markets = ['SOL','AVAX','LUNA','BTC'];

	//No of steps to run for each market
	const steps = Array.from({length: 9}, (_, i) => i + 1);

	markets.forEach(curMarket => {
		const solMarketInfo = Markets.find(
			(market) => market.baseAssetSymbol === curMarket
		);
			
		//Get the market details
		const marketAccount = clearingHouse.getMarket(solMarketInfo.marketIndex);
		const marketPrice = calculateMarkPrice(marketAccount);
		const marketPriceNumber = convertToNumber(marketPrice);
		
		//Calculate the deviation steps based on diff between mark and terminal price
		const terminalPriceNumber = convertToNumber(driftHelpers.calculateTerminalPrice(marketAccount), MARK_PRICE_PRECISION);
		const totalDeviation = (terminalPriceNumber-marketPriceNumber)/marketPriceNumber;
		const deviationStep = totalDeviation/steps.length;
		
		//Calculate the repeg cost for each step
		steps.forEach(step => {
			//Get deviation for current step
			const deviation = step*deviationStep;
			
			//Calculate the amount of trade that has to happen for the required deviation in price
			const[tradeBaseAmount,tradeDirection] = calculateMaxBaseAssetAmountToTrade(marketAccount.amm,marketPrice.muln(1+deviation),PositionDirection.LONG, false);
			
			//Simulate a shock in market after the trades
			const marketAccountAfterShock = calculateNewMarketAfterTrade(tradeBaseAmount,tradeDirection,marketAccount);
			marketAccountAfterShock.baseAssetAmount = marketAccountAfterShock.baseAssetAmount.add(tradeBaseAmount);
			marketAccountAfterShock.baseAssetAmountLong = marketAccountAfterShock.baseAssetAmountLong.add(tradeBaseAmount);
			
			//Now calculate the required peg deviation for the price to go back to mark price
			const marketPriceAfterShock = calculateMarkPrice(marketAccountAfterShock);
			const pegDeviation = (marketPrice.toNumber()-marketPriceAfterShock.toNumber())/marketPriceAfterShock.toNumber();

			//Calculate new peg
			const newPeg = marketAccountAfterShock.amm.pegMultiplier.muln(1+pegDeviation);

			//Calculate repeg cost
			console.log(`\nMarket: ${curMarket} | Deviation: ${deviation*100}% | New Peg: ${convertToNumber(newPeg,new BN(10**3))}`);
			driftHelpers.calculateRepegCost(marketAccountAfterShock,solMarketInfo.marketIndex,newPeg);
		})

	})


};

main();