"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateBudgetedPeg = exports.calculateBudgetedK = exports.calculateMaxBaseAssetAmountToTrade = exports.calculateTerminalPrice = exports.calculateRepegCost = exports.calculateAdjustKCost = exports.getSwapDirection = exports.calculateSwapOutput = exports.calculateAmmReservesAfterSwap = exports.calculatePrice = void 0;
const anchor_1 = require("@project-serum/anchor");
const numericConstants_1 = require("@drift-labs/sdk/lib/math/../constants/numericConstants");
const position_1 = require("@drift-labs/sdk/lib/math/position");
const types_1 = require("@drift-labs/sdk/lib/math/../types");
const assert_1 = require("@drift-labs/sdk/lib/math/../assert/assert");
const __1 = require("@drift-labs/sdk/lib/math/..");
/**
 * Calculates a price given an arbitrary base and quote amount (they must have the same precision)
 *
 * @param baseAssetAmount
 * @param quoteAssetAmount
 * @param peg_multiplier
 * @returns price : Precision MARK_PRICE_PRECISION
 */
function calculatePrice(baseAssetAmount, quoteAssetAmount, peg_multiplier) {
    if (baseAssetAmount.abs().lte(numericConstants_1.ZERO)) {
        return new anchor_1.BN(0);
    }
    return quoteAssetAmount
        .mul(numericConstants_1.MARK_PRICE_PRECISION)
        .mul(peg_multiplier)
        .div(numericConstants_1.PEG_PRECISION)
        .div(baseAssetAmount);
}
exports.calculatePrice = calculatePrice;
/**
 * Calculates what the amm reserves would be after swapping a quote or base asset amount.
 *
 * @param amm
 * @param inputAssetType
 * @param swapAmount
 * @param swapDirection
 * @returns quoteAssetReserve and baseAssetReserve after swap. : Precision AMM_RESERVE_PRECISION
 */
function calculateAmmReservesAfterSwap(amm, inputAssetType, swapAmount, swapDirection) {
    assert_1.assert(swapAmount.gte(numericConstants_1.ZERO), 'swapAmount must be greater than 0');
    let newQuoteAssetReserve;
    let newBaseAssetReserve;
    if (inputAssetType === 'quote') {
        swapAmount = swapAmount
            .mul(numericConstants_1.AMM_TIMES_PEG_TO_QUOTE_PRECISION_RATIO)
            .div(amm.pegMultiplier);
        [newQuoteAssetReserve, newBaseAssetReserve] = calculateSwapOutput(amm.quoteAssetReserve, swapAmount, swapDirection, amm.sqrtK.mul(amm.sqrtK));
    }
    else {
        [newBaseAssetReserve, newQuoteAssetReserve] = calculateSwapOutput(amm.baseAssetReserve, swapAmount, swapDirection, amm.sqrtK.mul(amm.sqrtK));
    }
    return [newQuoteAssetReserve, newBaseAssetReserve];
}
exports.calculateAmmReservesAfterSwap = calculateAmmReservesAfterSwap;
/**
 * Helper function calculating constant product curve output. Agnostic to whether input asset is quote or base
 *
 * @param inputAssetReserve
 * @param swapAmount
 * @param swapDirection
 * @param invariant
 * @returns newInputAssetReserve and newOutputAssetReserve after swap. : Precision AMM_RESERVE_PRECISION
 */
function calculateSwapOutput(inputAssetReserve, swapAmount, swapDirection, invariant) {
    let newInputAssetReserve;
    if (swapDirection === types_1.SwapDirection.ADD) {
        newInputAssetReserve = inputAssetReserve.add(swapAmount);
    }
    else {
        newInputAssetReserve = inputAssetReserve.sub(swapAmount);
    }
    const newOutputAssetReserve = invariant.div(newInputAssetReserve);
    return [newInputAssetReserve, newOutputAssetReserve];
}
exports.calculateSwapOutput = calculateSwapOutput;
/**
 * Translate long/shorting quote/base asset into amm operation
 *
 * @param inputAssetType
 * @param positionDirection
 */
function getSwapDirection(inputAssetType, positionDirection) {
    if (types_1.isVariant(positionDirection, 'long') && inputAssetType === 'base') {
        return types_1.SwapDirection.REMOVE;
    }
    if (types_1.isVariant(positionDirection, 'short') && inputAssetType === 'quote') {
        return types_1.SwapDirection.REMOVE;
    }
    return types_1.SwapDirection.ADD;
}
exports.getSwapDirection = getSwapDirection;
/**
 * Helper function calculating adjust k cost
 * @param market
 * @param marketIndex
 * @param numerator
 * @param denomenator
 * @returns cost : Precision QUOTE_ASSET_PRECISION
 */
function calculateAdjustKCost(market, marketIndex, numerator, denomenator) {
    const netUserPosition = {
        baseAssetAmount: market.baseAssetAmount,
        lastCumulativeFundingRate: market.amm.cumulativeFundingRate,
        marketIndex: new anchor_1.BN(marketIndex),
        quoteAssetAmount: new anchor_1.BN(0),
        openOrders: new anchor_1.BN(0),
    };
    const currentValue = position_1.calculateBaseAssetValue(market, netUserPosition);
    const marketNewK = Object.assign({}, market);
    marketNewK.amm = Object.assign({}, market.amm);
    marketNewK.amm.baseAssetReserve = market.amm.baseAssetReserve
        .mul(numerator)
        .div(denomenator);
    marketNewK.amm.quoteAssetReserve = market.amm.quoteAssetReserve
        .mul(numerator)
        .div(denomenator);
    marketNewK.amm.sqrtK = market.amm.sqrtK.mul(numerator).div(denomenator);
    netUserPosition.quoteAssetAmount = currentValue;
    const cost = __1.calculatePositionPNL(marketNewK, netUserPosition);
    const p = numericConstants_1.PEG_PRECISION.mul(numerator).div(denomenator);
    const x = market.amm.baseAssetReserve;
    const y = market.amm.quoteAssetReserve;
    const delta = market.baseAssetAmount;
    const k = market.amm.sqrtK.mul(market.amm.sqrtK);
    const numer1 = numericConstants_1.PEG_PRECISION.sub(p).mul(y).div(numericConstants_1.PEG_PRECISION);
    const numer20 = k
        .mul(p)
        .mul(p)
        .div(numericConstants_1.PEG_PRECISION)
        .div(numericConstants_1.PEG_PRECISION)
        .div(x.mul(p).div(numericConstants_1.PEG_PRECISION).add(delta));
    const numer21 = k.div(x.add(delta));
    const formulaCost = numer21
        .sub(numer20)
        .sub(numer1)
        .mul(market.amm.pegMultiplier)
        .div(numericConstants_1.AMM_TIMES_PEG_TO_QUOTE_PRECISION_RATIO);
        console.log(`k moves from ${market.amm.sqrtK.mul(market.amm.sqrtK)} to ${marketNewK.amm.sqrtK.mul(marketNewK.amm.sqrtK)}`)
        console.log(
            `Adjust k cost would be $${__1.convertToNumber(formulaCost, numericConstants_1.QUOTE_PRECISION)}`
        );
    // p.div(p.mul(x).add(delta)).sub()
    return cost;
}
exports.calculateAdjustKCost = calculateAdjustKCost;
/**
 * Helper function calculating adjust pegMultiplier (repeg) cost
 *
 * @param market
 * @param marketIndex
 * @param newPeg
 * @returns cost : Precision QUOTE_ASSET_PRECISION
 */
function calculateRepegCost(market, marketIndex, newPeg) {
    const netUserPosition = {
        baseAssetAmount: market.baseAssetAmount,
        lastCumulativeFundingRate: market.amm.cumulativeFundingRate,
        marketIndex: new anchor_1.BN(marketIndex),
        quoteAssetAmount: new anchor_1.BN(0),
        openOrders: new anchor_1.BN(0),
    };
    const currentValue = position_1.calculateBaseAssetValue(market, netUserPosition);
    netUserPosition.quoteAssetAmount = currentValue;
    const prevMarketPrice = __1.calculateMarkPrice(market);
    const marketNewPeg = Object.assign({}, market);
    marketNewPeg.amm = Object.assign({}, market.amm);
    // const marketNewPeg = JSON.parse(JSON.stringify(market));
    marketNewPeg.amm.pegMultiplier = newPeg;

    const oldTerminalPrice = __1.convertToNumber(
		calculateTerminalPrice(market),numericConstants_1.MARK_PRICE_PRECISION
	)
    const newTerminalPrice = __1.convertToNumber(
		calculateTerminalPrice(marketNewPeg),numericConstants_1.MARK_PRICE_PRECISION
	)

    const cost = __1.calculatePositionPNL(marketNewPeg, netUserPosition);
    const k = market.amm.sqrtK.mul(market.amm.sqrtK);
    const newQuoteAssetReserve = k.div(market.amm.baseAssetReserve.add(netUserPosition.baseAssetAmount));
    const deltaQuoteAssetReserves = newQuoteAssetReserve.sub(market.amm.quoteAssetReserve);
    const cost2 = deltaQuoteAssetReserves
        .mul(market.amm.pegMultiplier.sub(newPeg))
        .div(numericConstants_1.AMM_TIMES_PEG_TO_QUOTE_PRECISION_RATIO);
        
    console.log(`Peg moves from ${__1.convertToNumber(market.amm.pegMultiplier,numericConstants_1.PEG_PRECISION)} to ${__1.convertToNumber(newPeg,numericConstants_1.PEG_PRECISION)}`)
    console.log(`Price moves from $${__1.convertToNumber(prevMarketPrice)} to $${__1.convertToNumber(__1.calculateMarkPrice(marketNewPeg))}`);
    console.log(`Terminal Price moves from $${oldTerminalPrice} to $${newTerminalPrice}`);
    console.log(`Repeg cost would be $${__1.convertToNumber(cost2, numericConstants_1.QUOTE_PRECISION)}`);
    return cost;
}
exports.calculateRepegCost = calculateRepegCost;
/**
 * Helper function calculating terminal price of amm
 *
 * @param market
 * @returns cost : Precision MARK_PRICE_PRECISION
 */
function calculateTerminalPrice(market) {
    const directionToClose = market.baseAssetAmount.gt(numericConstants_1.ZERO)
        ? types_1.PositionDirection.SHORT
        : types_1.PositionDirection.LONG;
    const [newQuoteAssetReserve, newBaseAssetReserve] = calculateAmmReservesAfterSwap(market.amm, 'base', market.baseAssetAmount.abs(), getSwapDirection('base', directionToClose));
    const terminalPrice = newQuoteAssetReserve
        .mul(numericConstants_1.MARK_PRICE_PRECISION)
        .mul(market.amm.pegMultiplier)
        .div(numericConstants_1.PEG_PRECISION)
        .div(newBaseAssetReserve);
    return terminalPrice;
}
exports.calculateTerminalPrice = calculateTerminalPrice;
function calculateMaxBaseAssetAmountToTrade(amm, limit_price) {
    const invariant = amm.sqrtK.mul(amm.sqrtK);
    const newBaseAssetReserveSquared = invariant
        .mul(numericConstants_1.MARK_PRICE_PRECISION)
        .mul(amm.pegMultiplier)
        .div(limit_price)
        .div(numericConstants_1.PEG_PRECISION);
    const newBaseAssetReserve = __1.squareRootBN(newBaseAssetReserveSquared);
    if (newBaseAssetReserve.gt(amm.baseAssetReserve)) {
        return [
            newBaseAssetReserve.sub(amm.baseAssetReserve),
            types_1.PositionDirection.SHORT,
        ];
    }
    else if (newBaseAssetReserve.lt(amm.baseAssetReserve)) {
        return [
            amm.baseAssetReserve.sub(newBaseAssetReserve),
            types_1.PositionDirection.LONG,
        ];
    }
    else {
        console.log('tradeSize Too Small');
        return [new anchor_1.BN(0), types_1.PositionDirection.LONG];
    }
}
exports.calculateMaxBaseAssetAmountToTrade = calculateMaxBaseAssetAmountToTrade;
function calculateBudgetedK(market, cost) {
    // wolframalpha.com
    // (1/(x+d) - p/(x*p+d))*y*d*Q = C solve for p
    // p = (d(y*d*Q - C(x+d))) / (C*x(x+d) + y*y*d*Q)
    // todo: assumes k = x * y
    // otherwise use: (y(1-p) + (kp^2/(x*p+d)) - k/(x+d)) * Q = C solve for p
    // const k = market.amm.sqrtK.mul(market.amm.sqrtK);
    const x = market.amm.baseAssetReserve;
    const y = market.amm.quoteAssetReserve;
    const d = market.baseAssetAmount;
    const Q = market.amm.pegMultiplier;
    const C = cost.mul(new anchor_1.BN(-1));
    const numer1 = y.mul(d).mul(Q).div(numericConstants_1.AMM_RESERVE_PRECISION).div(numericConstants_1.PEG_PRECISION);
    const numer2 = C.mul(x.add(d)).div(numericConstants_1.QUOTE_PRECISION);
    const denom1 = C.mul(x)
        .mul(x.add(d))
        .div(numericConstants_1.AMM_RESERVE_PRECISION)
        .div(numericConstants_1.QUOTE_PRECISION);
    const denom2 = y
        .mul(d)
        .mul(d)
        .mul(Q)
        .div(numericConstants_1.AMM_RESERVE_PRECISION)
        .div(numericConstants_1.AMM_RESERVE_PRECISION)
        .div(numericConstants_1.PEG_PRECISION);
    const numerator = d
        .mul(numer1.add(numer2))
        .div(numericConstants_1.AMM_RESERVE_PRECISION)
        .div(numericConstants_1.AMM_RESERVE_PRECISION)
        .div(numericConstants_1.AMM_TO_QUOTE_PRECISION_RATIO);
    const denominator = denom1
        .add(denom2)
        .div(numericConstants_1.AMM_RESERVE_PRECISION)
        .div(numericConstants_1.AMM_TO_QUOTE_PRECISION_RATIO);
    console.log(numerator, denominator);
    // const p = (numerator).div(denominator);
    // const formulaCost = (numer21.sub(numer20).sub(numer1)).mul(market.amm.pegMultiplier).div(AMM_TIMES_PEG_TO_QUOTE_PRECISION_RATIO)
    // console.log(convertToNumber(formulaCost, QUOTE_PRECISION))
    return [numerator, denominator];
}
exports.calculateBudgetedK = calculateBudgetedK;
function calculateBudgetedPeg(market, cost) {
    // wolframalpha.com
    // (1/(x+d) - p/(x*p+d))*y*d*Q = C solve for p
    // p = (d(y*d*Q - C(x+d))) / (C*x(x+d) + y*y*d*Q)
    // todo: assumes k = x * y
    // otherwise use: (y(1-p) + (kp^2/(x*p+d)) - k/(x+d)) * Q = C solve for p
    const k = market.amm.sqrtK.mul(market.amm.sqrtK);
    const x = market.amm.baseAssetReserve;
    const y = market.amm.quoteAssetReserve;
    const d = market.baseAssetAmount;
    const Q = market.amm.pegMultiplier;
    const C = cost.mul(new anchor_1.BN(-1));
    const deltaQuoteAssetReserves = y.sub(k.div(x.add(d)));
    const deltaPegMultiplier = C.mul(numericConstants_1.MARK_PRICE_PRECISION)
        .div(deltaQuoteAssetReserves.div(numericConstants_1.AMM_TO_QUOTE_PRECISION_RATIO))
        .mul(numericConstants_1.PEG_PRECISION)
        .div(numericConstants_1.QUOTE_PRECISION);
    console.log(Q.toNumber(), 'change by', deltaPegMultiplier.toNumber() / numericConstants_1.MARK_PRICE_PRECISION.toNumber());
    const newPeg = Q.sub(deltaPegMultiplier.mul(numericConstants_1.PEG_PRECISION).div(numericConstants_1.MARK_PRICE_PRECISION));
    return newPeg;
}
exports.calculateBudgetedPeg = calculateBudgetedPeg;
