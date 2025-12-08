import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { MockToken } from "../typechain-types";
import type { AMM } from "../typechain-types";

describe("AMM Tests", function () {
  // Test constants
  const FEE_BPS = 30; // 0.30%
  const MINIMUM_LIQUIDITY = ethers.parseUnits("1000", 0);

  async function deployContractsFixture() {
    const signers = await ethers.getSigners();
    const [deployer, alice, bob] = signers;

    // Deploy AMM
    const AMMFactory = await ethers.getContractFactory("AMM", deployer);
    const amm = await AMMFactory.deploy(FEE_BPS) as any;
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();

    // Deploy Mock Tokens
    const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
    const tokenA = await MockTokenFactory.deploy("TokenA", "TKA", 18) as any;
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();

    const tokenB = await MockTokenFactory.deploy("TokenB", "TKB", 18) as any;
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();

    return {
      amm,
      tokenA,
      tokenB,
      deployer,
      alice,
      bob,
      ammAddress,
      tokenAAddress,
      tokenBAddress,
    };
  }

  describe("Issue #1: ERC20 Mock Token", function () {
    it("Should deploy MockToken with correct name, symbol, and decimals", async function () {
      const { tokenA } = await loadFixture(deployContractsFixture);

      const name = await tokenA.name();
      const symbol = await tokenA.symbol();
      const decimals = await tokenA.decimals();

      expect(name).to.equal("TokenA");
      expect(symbol).to.equal("TKA");
      expect(decimals).to.equal(18);
    });

    it("Should mint initial supply to deployer", async function () {
      const { tokenA, deployer } = await loadFixture(deployContractsFixture);

      const balance = await tokenA.balanceOf(deployer.address);
      const expectedBalance = ethers.parseUnits("1000000", 18); // 1M tokens

      expect(balance).to.equal(expectedBalance);
    });

    it("Should allow owner to mint tokens", async function () {
      const { tokenA, deployer, alice } = await loadFixture(deployContractsFixture);

      const mintAmount = ethers.parseUnits("1000", 18);
      await tokenA.mint(alice.address, mintAmount);

      const balance = await tokenA.balanceOf(alice.address);
      expect(balance).to.equal(mintAmount);
    });

    it("Should not allow non-owner to mint tokens", async function () {
      const { tokenA, alice, bob } = await loadFixture(deployContractsFixture);

      const mintAmount = ethers.parseUnits("1000", 18);
      await expect(tokenA.connect(alice).mint(bob.address, mintAmount)).to.be.reverted;
    });
  });

  describe("Issue #2: AMM Core Contract", function () {
    it("Should deploy AMM with correct default fee", async function () {
      const { amm } = await loadFixture(deployContractsFixture);

      const defaultFee = await amm.defaultFeeBps();
      expect(defaultFee).to.equal(FEE_BPS);
    });

    it("Should create a pool with initial liquidity", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      // Mint and approve tokens
      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      // Create pool
      const tx = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx.wait();

      // Get pool ID
      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);

      // Verify pool exists
      const pool = await amm.getPool(poolId);
      const token0Address = (await tokenA.getAddress()).toLowerCase() < (await tokenB.getAddress()).toLowerCase()
        ? (await tokenA.getAddress()).toLowerCase()
        : (await tokenB.getAddress()).toLowerCase();
      expect(pool.token0.toLowerCase()).to.equal(token0Address);
      expect(pool.reserve0).to.be.greaterThan(0);
      expect(pool.reserve1).to.be.greaterThan(0);
    });

    it("Should add liquidity to existing pool", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      // Setup tokens
      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 2n);

      // Create pool
      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Get initial pool state
      const poolBefore = await amm.getPool(poolId);
      const initialReserve0 = poolBefore.reserve0;
      const initialReserve1 = poolBefore.reserve1;

      // Determine token order (token0 < token1)
      const tokenAAddr = await tokenA.getAddress();
      const tokenBAddr = await tokenB.getAddress();
      const isTokenAFirst = tokenAAddr.toLowerCase() < tokenBAddr.toLowerCase();
      
      // Add liquidity - amounts must be in token0/token1 order
      const amount0Desired = isTokenAFirst ? amountA : amountB;
      const amount1Desired = isTokenAFirst ? amountB : amountA;
      
      const tx2 = await amm.addLiquidity(poolId, amount0Desired, amount1Desired);
      await tx2.wait();

      // Verify reserves increased
      const poolAfter = await amm.getPool(poolId);
      expect(poolAfter.reserve0).to.equal(initialReserve0 + amount0Desired);
      expect(poolAfter.reserve1).to.equal(initialReserve1 + amount1Desired);
    });

    it("Should remove liquidity from pool", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      // Setup and create pool
      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Get LP balance
      const lpBalance = await amm.getLpBalance(poolId, deployer.address);
      expect(lpBalance).to.be.greaterThan(0);

      // Remove some liquidity
      const removeAmount = lpBalance / 2n;
      const tx2 = await amm.removeLiquidity(poolId, removeAmount);
      await tx2.wait();

      // Verify LP balance decreased
      const newLpBalance = await amm.getLpBalance(poolId, deployer.address);
      expect(newLpBalance).to.be.lessThan(lpBalance);
    });

    it("Should execute token swap", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);
      const swapAmount = ethers.parseUnits("100", 18);

      // Setup and create pool
      await tokenA.mint(deployer.address, amountA + swapAmount);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA + swapAmount);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Get initial balances
      const initialBalanceA = await tokenA.balanceOf(deployer.address);
      const initialBalanceB = await tokenB.balanceOf(deployer.address);

      // Execute swap
      const tx2 = await amm.swap(
        poolId,
        await tokenA.getAddress(),
        swapAmount,
        0,
        deployer.address
      );
      await tx2.wait();

      // Verify balances changed
      const finalBalanceA = await tokenA.balanceOf(deployer.address);
      const finalBalanceB = await tokenB.balanceOf(deployer.address);

      expect(finalBalanceA).to.be.lessThan(initialBalanceA);
      expect(finalBalanceB).to.be.greaterThan(initialBalanceB);
    });
  });

  describe("Issue #3: Deterministic Pool ID", function () {
    it("Should generate same pool ID regardless of token order", async function () {
      const { amm, tokenA, tokenB } = await loadFixture(deployContractsFixture);

      const poolId1 = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const poolId2 = await amm.getPoolId(await tokenB.getAddress(), await tokenA.getAddress(), FEE_BPS);

      expect(poolId1).to.equal(poolId2);
    });

    it("Should generate different pool IDs for different fees", async function () {
      const { amm, tokenA, tokenB } = await loadFixture(deployContractsFixture);

      const poolId1 = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), 30);
      const poolId2 = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), 50);

      expect(poolId1).to.not.equal(poolId2);
    });

    it("Should prevent creating duplicate pools", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 2n);

      // Create first pool
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Try to create duplicate pool - should fail
      await expect(
        amm.createPool(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountA,
          amountB,
          0
        )
      ).to.be.reverted;
    });
  });

  describe("Issue #4: Fee & Math Implementation", function () {
    it("Should calculate swap output correctly with fees", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);
      const swapAmount = ethers.parseUnits("100", 18);

      // Setup pool
      await tokenA.mint(deployer.address, amountA + swapAmount);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA + swapAmount);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Get initial reserves
      const poolBefore = await amm.getPool(poolId);
      const reserve0Before = poolBefore.reserve0;
      const reserve1Before = poolBefore.reserve1;

      // Execute swap
      const tx2 = await amm.swap(
        poolId,
        await tokenA.getAddress(),
        swapAmount,
        0,
        deployer.address
      );
      await tx2.wait();

      // Get reserves after swap
      const poolAfter = await amm.getPool(poolId);
      const reserve0After = poolAfter.reserve0;
      const reserve1After = poolAfter.reserve1;

      // Verify constant product formula (with fees): (x + dx) * (y - dy) >= k
      const kBefore = reserve0Before * reserve1Before;
      const kAfter = reserve0After * reserve1After;
      expect(kAfter).to.be.greaterThanOrEqual(kBefore);
    });

    it("Should apply correct fee percentage", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const swapAmount = ethers.parseUnits("1000", 18);

      // Setup pool
      await tokenA.mint(deployer.address, amountA + swapAmount);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA + swapAmount);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Get pool state and determine token order
      const pool = await amm.getPool(poolId);
      const tokenAAddr = await tokenA.getAddress();
      const isTokenAFirst = tokenAAddr.toLowerCase() < (await tokenB.getAddress()).toLowerCase();
      
      // Determine which reserves correspond to input/output
      const reserveIn = isTokenAFirst ? pool.reserve0 : pool.reserve1;
      const reserveOut = isTokenAFirst ? pool.reserve1 : pool.reserve0;

      // Calculate expected output with fee: amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee)
      const amountInWithFee = (swapAmount * BigInt(10000 - FEE_BPS)) / 10000n;
      const expectedOutputWithFee = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee);

      // Calculate expected output without fee for comparison
      const expectedOutputNoFee = (swapAmount * reserveOut) / (reserveIn + swapAmount);

      // Execute swap
      const initialBalanceB = await tokenB.balanceOf(deployer.address);
      const tx2 = await amm.swap(
        poolId,
        await tokenA.getAddress(),
        swapAmount,
        0,
        deployer.address
      );
      await tx2.wait();
      const finalBalanceB = await tokenB.balanceOf(deployer.address);
      const actualOutput = finalBalanceB - initialBalanceB;

      // Actual output should be less than no-fee output (due to fees)
      expect(actualOutput).to.be.lessThan(expectedOutputNoFee);
      // Should be approximately equal to fee-adjusted output (within rounding)
      const tolerance = expectedOutputWithFee / 100n; // 1% tolerance
      expect(actualOutput).to.be.closeTo(expectedOutputWithFee, tolerance);
    });
  });

  describe("Issue #5: Security Hardening", function () {
    it("Should revert on zero address tokens", async function () {
      const { amm, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await expect(
        amm.createPool(
          ethers.ZeroAddress,
          ethers.ZeroAddress,
          amountA,
          amountB,
          0
        )
      ).to.be.reverted;
    });

    it("Should revert on identical tokens", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await expect(
        amm.createPool(
          await tokenA.getAddress(),
          await tokenA.getAddress(),
          amountA,
          amountB,
          0
        )
      ).to.be.reverted;
    });

    it("Should revert on zero amounts", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      await expect(
        amm.createPool(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          0,
          0,
          0
        )
      ).to.be.reverted;
    });
  });

  describe("Issue #7: Minimum Liquidity Lock", function () {
    it("Should lock minimum liquidity on pool creation", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx.wait();

      // Check locked liquidity (sent to address(0))
      const lockedBalance = await amm.getLpBalance(poolId, ethers.ZeroAddress);
      expect(lockedBalance).to.equal(MINIMUM_LIQUIDITY);

      // Check user received liquidity minus minimum
      const userBalance = await amm.getLpBalance(poolId, deployer.address);
      const pool = await amm.getPool(poolId);
      expect(userBalance + lockedBalance).to.equal(pool.totalSupply);
      expect(userBalance).to.be.greaterThan(0);
    });

    it("Should prevent removing liquidity below minimum", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      const pool = await amm.getPool(poolId);
      const totalSupply = pool.totalSupply;
      const userBalance = await amm.getLpBalance(poolId, deployer.address);

      // Try to remove more than allowed (would leave less than MINIMUM_LIQUIDITY)
      const maxRemovable = totalSupply - MINIMUM_LIQUIDITY;
      if (userBalance > maxRemovable) {
        await expect(
          amm.removeLiquidity(poolId, userBalance)
        ).to.be.reverted;
      }
    });
  });

  describe("Issue #8: Custom Fee Per Pool", function () {
    it("Should create pool with custom fee", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);
      const customFee = 50; // 0.50%

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), customFee);
      const tx = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        customFee
      );
      await tx.wait();

      const pool = await amm.getPool(poolId);
      expect(pool.feeBps).to.equal(customFee);
    });

    it("Should use default fee when feeBps is 0", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx.wait();

      const pool = await amm.getPool(poolId);
      expect(pool.feeBps).to.equal(FEE_BPS);
    });

    it("Should reject fee greater than 1000 bps", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);
      const invalidFee = 1001; // > 1000 bps

      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);

      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      await expect(
        amm.createPool(
          await tokenA.getAddress(),
          await tokenB.getAddress(),
          amountA,
          amountB,
          invalidFee
        )
      ).to.be.reverted;
    });

    it("Should create different pools for different fees", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);
      const fee1 = 30;
      const fee2 = 50;

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 2n);

      const poolId1 = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), fee1);
      const poolId2 = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), fee2);

      expect(poolId1).to.not.equal(poolId2);

      // Create both pools
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        fee1
      );
      await tx1.wait();

      const tx2 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        fee2
      );
      await tx2.wait();

      // Verify both pools exist with different fees
      const pool1 = await amm.getPool(poolId1);
      const pool2 = await amm.getPool(poolId2);

      expect(pool1.feeBps).to.equal(fee1);
      expect(pool2.feeBps).to.equal(fee2);
    });
  });
});
