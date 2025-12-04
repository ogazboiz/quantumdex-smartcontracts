import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { network } from "hardhat";
import { parseEventLogs } from "viem";

describe("AMM", async () => {
  const FEE_BPS = 30; // 0.30%

  const { viem }: any = await network.connect();

  const publicClient = await viem.getPublicClient();

  let amm: any;
  let tokenA: any;
  let tokenB: any;
  let deployer: any;
  let poolId: `0x${string}`;

  before(async () => {
    [deployer] = await viem.getWalletClients();

    tokenA = await viem.deployContract("MockToken", ["TokenA", "TKA", 18], {
      account: deployer.account,
    });
    tokenB = await viem.deployContract("MockToken", ["TokenB", "TKB", 18], {
      account: deployer.account,
    });

    amm = await viem.deployContract("AMM", [FEE_BPS], { account: deployer.account });
  });

  it("creates a pool and mints initial liquidity", async () => {
    const initialA = 1_000n * 10n ** 18n;
    const initialB = 2_000n * 10n ** 18n;

    // Sanity checks: all contract addresses involved must be distinct
    assert.notEqual(tokenA.address, tokenB.address);
    assert.notEqual(tokenA.address, amm.address);
    assert.notEqual(tokenB.address, amm.address);

    await tokenA.write.approve([amm.address, initialA], { account: deployer.account });
    await tokenB.write.approve([amm.address, initialB], { account: deployer.account });

    const tx = await amm.write.createPool(
      [tokenA.address, tokenB.address, initialA, initialB],
      { account: deployer.account },
    );
    const receipt = await publicClient.getTransactionReceipt({ hash: tx });

    // Parse logs properly using parseEventLogs
    const logs = parseEventLogs({
      abi: amm.abi,
      logs: receipt.logs,
      eventName: "PoolCreated",
    }) as any[];

    assert.equal(logs.length, 1, "Should emit exactly one PoolCreated event");

    poolId = logs[0].args.poolId as `0x${string}`;
    assert.ok(poolId, "Pool ID should be defined");

    const [token0, token1, reserve0, reserve1, feeBps, totalSupply] = await amm.read.getPool([
      poolId,
    ]);

    assert.equal(feeBps, FEE_BPS, "Fee should match");

    const expectedTokens = [tokenA.address.toLowerCase(), tokenB.address.toLowerCase()];
    assert.ok(expectedTokens.includes((token0 as string).toLowerCase()), "Token0 should be either tokenA or tokenB");
    assert.ok(expectedTokens.includes((token1 as string).toLowerCase()), "Token1 should be either tokenA or tokenB");
    assert.notEqual((token0 as string).toLowerCase(), (token1 as string).toLowerCase(), "Token0 and Token1 should be distinct");

    // LP balance should be less than totalSupply due to locked MINIMUM_LIQUIDITY
    const lpBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);
    assert.ok(BigInt(lpBalance) < BigInt(totalSupply), "LP balance should be less than total supply due to locked liquidity");
    
    // Verify MINIMUM_LIQUIDITY is locked to address(0)
    const lockedBalance = await amm.read.getLpBalance([poolId, "0x0000000000000000000000000000000000000000"]);
    assert.equal(lockedBalance, 1000n, "MINIMUM_LIQUIDITY should be locked to address(0)");

    // Reserves should match initial deposits (modulo ordering)
    assert.equal(reserve0 + reserve1, initialA + initialB, "Total reserves should match deposits");
  });

  it("allows adding and removing liquidity", async () => {
    const extraA = 500n * 10n ** 18n;
    const extraB = 1_000n * 10n ** 18n;

    // Get poolId from previous test (or re-fetch it)
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });

      assert.ok(events.length > 0, "Should have at least one pool");
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [,,, , , totalSupplyBefore] = await amm.read.getPool([poolId]);
    const lpBalanceBefore = await amm.read.getLpBalance([poolId, deployer.account.address]);

    await tokenA.write.approve([amm.address, extraA], { account: deployer.account });
    await tokenB.write.approve([amm.address, extraB], { account: deployer.account });

    const addRes = await amm.write.addLiquidity([poolId, extraA, extraB], {
      account: deployer.account,
    });
    await publicClient.getTransactionReceipt({ hash: addRes });

    const [,,, , , totalSupplyAfter] = await amm.read.getPool([poolId]);
    const lpBalanceAfter = await amm.read.getLpBalance([poolId, deployer.account.address]);

    assert.ok(BigInt(totalSupplyAfter) > BigInt(totalSupplyBefore), "Total supply should increase");
    assert.ok(BigInt(lpBalanceAfter) > BigInt(lpBalanceBefore), "LP balance should increase");

    const liquidityToRemove = (BigInt(lpBalanceAfter) - BigInt(lpBalanceBefore)) / 2n;
    const removeRes = await amm.write.removeLiquidity([poolId, liquidityToRemove], {
      account: deployer.account,
    });
    await publicClient.getTransactionReceipt({ hash: removeRes });

    const lpBalanceFinal = await amm.read.getLpBalance([poolId, deployer.account.address]);
    assert.equal(lpBalanceFinal, lpBalanceAfter - liquidityToRemove, "LP balance should decrease by removed amount");
  });

  it("executes a swap with fee and constant product", async () => {
    // Get poolId from previous test
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });

      assert.ok(events.length > 0, "Should have at least one pool");
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [token0, token1, reserve0Before, reserve1Before] = await amm.read.getPool([
      poolId,
    ]);

    const amountIn = 100n * 10n ** 18n;

    // Choose token0 as input token
    const tokenIn = token0;
    const tokenInContract = tokenIn === tokenA.address ? tokenA : tokenB;

    // IMPORTANT: Approve the AMM contract to spend tokens from the deployer
    // Use tokenInContract.write.approve instead of deployer.writeContract
    await tokenInContract.write.approve([amm.address, amountIn], { 
      account: deployer.account 
    });

    // Verify the allowance was set correctly
    const allowance = await tokenInContract.read.allowance([
      deployer.account.address,
      amm.address,
    ]);
    assert.equal(allowance, amountIn, "Allowance should be set correctly");

    const minAmountOut = 1n; // loose slippage for test
    
    // Use amm.write.swap instead of deployer.writeContract for cleaner syntax
    const swapRes = await amm.write.swap(
      [poolId, tokenIn, amountIn, minAmountOut, deployer.account.address],
      { account: deployer.account }
    );
    
    const swapReceipt = await publicClient.getTransactionReceipt({ hash: swapRes });

    // Parse swap logs properly
    const swapLogs = parseEventLogs({
      abi: amm.abi,
      logs: swapReceipt.logs,
      eventName: "Swap",
    }) as any[];

    assert.equal(swapLogs.length, 1, "Should emit exactly one Swap event");

    const amountOut = swapLogs[0].args.amountOut as bigint;
    assert.ok(amountOut > 0n, "Amount out should be positive");

    const [,, reserve0After, reserve1After] = await amm.read.getPool([poolId]);

    const kBefore = BigInt(reserve0Before) * BigInt(reserve1Before);
    const kAfter = BigInt(reserve0After) * BigInt(reserve1After);

    // With fee, kAfter should be >= kBefore
    assert.ok(kAfter >= kBefore, "K should not decrease (constant product with fees)");
  });

  it("calculates correct swap amounts with fee", async () => {
    // Get poolId
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [token0, , reserve0Before, reserve1Before, feeBps] = await amm.read.getPool([poolId]);

    const amountIn = 50n * 10n ** 18n;
    const tokenInContract = token0 === tokenA.address ? tokenA : tokenB;

    // Calculate expected output
    const amountInWithFee = (amountIn * (10000n - BigInt(feeBps))) / 10000n;
    const numerator = amountInWithFee * BigInt(reserve1Before);
    const denominator = BigInt(reserve0Before) + amountInWithFee;
    const expectedAmountOut = numerator / denominator;

    // Execute swap
    await tokenInContract.write.approve([amm.address, amountIn], { 
      account: deployer.account 
    });

    const swapRes = await amm.write.swap(
      [poolId, token0, amountIn, 1n, deployer.account.address],
      { account: deployer.account }
    );

    const swapReceipt = await publicClient.getTransactionReceipt({ hash: swapRes });
    const swapLogs = parseEventLogs({
      abi: amm.abi,
      logs: swapReceipt.logs,
      eventName: "Swap",
    }) as any[];

    const actualAmountOut = swapLogs[0].args.amountOut as bigint;

    // Should match expected (or be very close due to rounding)
    assert.ok(
      actualAmountOut === expectedAmountOut || 
      actualAmountOut === expectedAmountOut + 1n ||
      actualAmountOut === expectedAmountOut - 1n,
      "Actual amount out should match expected calculation"
    );
  });

  it("prevents double pool creation", async () => {
    const amount = 100n * 10n ** 18n;

    await tokenA.write.approve([amm.address, amount], { account: deployer.account });
    await tokenB.write.approve([amm.address, amount], { account: deployer.account });

    // Try to create the same pool again
    await assert.rejects(
      async () => {
        await amm.write.createPool(
          [tokenA.address, tokenB.address, amount, amount],
          { account: deployer.account }
        );
      },
      /pool exists/,
      "Should revert with 'pool exists'"
    );
  });

  it("enforces minimum liquidity requirements", async () => {
    // Try to add zero liquidity
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    await assert.rejects(
      async () => {
        await amm.write.addLiquidity([poolId, 0n, 100n * 10n ** 18n], {
          account: deployer.account
        });
      },
      /insufficient amounts/,
      "Should revert with 'insufficient amounts'"
    );
  });

  it("enforces slippage protection on swaps", async () => {
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [token0] = await amm.read.getPool([poolId]);
    const tokenInContract = token0 === tokenA.address ? tokenA : tokenB;
    const amountIn = 10n * 10n ** 18n;

    await tokenInContract.write.approve([amm.address, amountIn], { 
      account: deployer.account 
    });

    // Set unrealistic minAmountOut (higher than possible)
    const unrealisticMin = 1000n * 10n ** 18n;

    await assert.rejects(
      async () => {
        await amm.write.swap(
          [poolId, token0, amountIn, unrealisticMin, deployer.account.address],
          { account: deployer.account }
        );
      },
      /slippage/,
      "Should revert with 'slippage'"
    );
  });

  it("reverts pool creation if liquidity is below MINIMUM_LIQUIDITY", async () => {
    const smallA = 1n;
    const smallB = 1n;

    await tokenA.write.approve([amm.address, smallA], { account: deployer.account });
    await tokenB.write.approve([amm.address, smallB], { account: deployer.account });

    await assert.rejects(
      async () => {
        await amm.write.createPool(
          [tokenA.address, tokenB.address, smallA, smallB],
          { account: deployer.account }
        );
      },
      /insufficient liquidity/,
      "Should revert with 'insufficient liquidity' when below MINIMUM_LIQUIDITY"
    );
  });

  it("prevents removing liquidity below MINIMUM_LIQUIDITY", async () => {
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [, , , , , totalSupply] = await amm.read.getPool([poolId]);
    const lpBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);

    // Try to remove all liquidity (should fail)
    await assert.rejects(
      async () => {
        await amm.write.removeLiquidity([poolId, lpBalance], {
          account: deployer.account
        });
      },
      /insufficient liquidity/,
      "Should revert when trying to remove all liquidity"
    );
  });

  it("allows removing liquidity that leaves at least MINIMUM_LIQUIDITY", async () => {
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [, , , , , totalSupply] = await amm.read.getPool([poolId]);
    const lpBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);

    // Remove liquidity that leaves exactly MINIMUM_LIQUIDITY
    const liquidityToRemove = lpBalance - 1000n; // Leave 1000 locked
    if (liquidityToRemove > 0n) {
      const removeRes = await amm.write.removeLiquidity([poolId, liquidityToRemove], {
        account: deployer.account
      });
      await publicClient.getTransactionReceipt({ hash: removeRes });

      const [, , , , , newTotalSupply] = await amm.read.getPool([poolId]);
      assert.equal(newTotalSupply, 1000n, "Total supply should equal MINIMUM_LIQUIDITY");
    }
  });

  it("verifies locked liquidity calculation is correct", async () => {
    const initialA = 5_000n * 10n ** 18n;
    const initialB = 10_000n * 10n ** 18n;

    // Create a new pool for this test
    const tokenC = await viem.deployContract("MockToken", ["TokenC", "TKC", 18], {
      account: deployer.account,
    });
    const tokenD = await viem.deployContract("MockToken", ["TokenD", "TKD", 18], {
      account: deployer.account,
    });

    await tokenC.write.approve([amm.address, initialA], { account: deployer.account });
    await tokenD.write.approve([amm.address, initialB], { account: deployer.account });

    const tx = await amm.write.createPool(
      [tokenC.address, tokenD.address, initialA, initialB],
      { account: deployer.account }
    );
    const receipt = await publicClient.getTransactionReceipt({ hash: tx });

    const logs = parseEventLogs({
      abi: amm.abi,
      logs: receipt.logs,
      eventName: "PoolCreated",
    }) as any[];

    const newPoolId = logs[0].args.poolId as `0x${string}`;
    const [, , , , , totalSupply] = await amm.read.getPool([newPoolId]);
    const userBalance = await amm.read.getLpBalance([newPoolId, deployer.account.address]);
    const lockedBalance = await amm.read.getLpBalance([newPoolId, "0x0000000000000000000000000000000000000000"]);

    // Verify calculations
    const expectedTotal = BigInt(totalSupply);
    const expectedUser = BigInt(userBalance);
    const expectedLocked = BigInt(lockedBalance);

    assert.equal(expectedLocked, 1000n, "Locked liquidity should be exactly 1000");
    assert.equal(expectedTotal, expectedUser + expectedLocked, "Total supply should equal user + locked");
    assert.ok(expectedUser > 0n, "User should receive liquidity");
  });

  it("handles edge case where calculated liquidity equals MINIMUM_LIQUIDITY", async () => {
    // This test verifies that liquidity must be strictly greater than MINIMUM_LIQUIDITY
    // If sqrt(x * y) exactly equals 1000, it should still revert
    const tokenE = await viem.deployContract("MockToken", ["TokenE", "TKE", 18], {
      account: deployer.account,
    });
    const tokenF = await viem.deployContract("MockToken", ["TokenF", "TKF", 18], {
      account: deployer.account,
    });

    // Try to create pool with amounts that would give exactly 1000 liquidity
    // sqrt(1000 * 1000) = 1000, which should fail the > check
    const amount = 1000n * 10n ** 18n;

    await tokenE.write.approve([amm.address, amount], { account: deployer.account });
    await tokenF.write.approve([amm.address, amount], { account: deployer.account });

    await assert.rejects(
      async () => {
        await amm.write.createPool(
          [tokenE.address, tokenF.address, amount, amount],
          { account: deployer.account }
        );
      },
      /insufficient liquidity/,
      "Should revert when liquidity equals MINIMUM_LIQUIDITY"
    );
  });

  it("prevents multiple removals from draining pool below minimum", async () => {
    if (!poolId) {
      const events = await publicClient.getContractEvents({
        address: amm.address,
        abi: amm.abi,
        eventName: "PoolCreated",
        fromBlock: 0n,
        strict: true,
      });
      poolId = (events[0] as any).args.poolId as `0x${string}`;
    }

    const [, , , , , totalSupply] = await amm.read.getPool([poolId]);
    const lpBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);

    // Try to remove liquidity in multiple steps
    const firstRemoval = lpBalance / 2n;
    if (firstRemoval > 0n) {
      const remove1 = await amm.write.removeLiquidity([poolId, firstRemoval], {
        account: deployer.account
      });
      await publicClient.getTransactionReceipt({ hash: remove1 });

      const remainingBalance = await amm.read.getLpBalance([poolId, deployer.account.address]);
      
      // Try to remove all remaining (should fail)
      await assert.rejects(
        async () => {
          await amm.write.removeLiquidity([poolId, remainingBalance], {
            account: deployer.account
          });
        },
        /insufficient liquidity/,
        "Should prevent removing all remaining liquidity"
      );
    }
  });
});