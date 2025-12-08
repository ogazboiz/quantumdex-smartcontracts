import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("AMM Tests", function () {
  // Test constants
  const FEE_BPS = 30; // 0.30%
  const MINIMUM_LIQUIDITY = ethers.parseUnits("1000", 0);

  async function deployContractsFixture() {
    const signers = await ethers.getSigners();
    const [deployer, alice, bob] = signers;

    // Deploy AMM
    const AMMFactory = await ethers.getContractFactory("AMM", deployer);
    const amm = await AMMFactory.deploy(FEE_BPS);
    await amm.waitForDeployment();
    const ammAddress = await amm.getAddress();

    // Deploy Mock Tokens
    const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
    const tokenA = await MockTokenFactory.deploy("TokenA", "TKA", 18);
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();

    const tokenB = await MockTokenFactory.deploy("TokenB", "TKB", 18);
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

  describe("Issue #9: Native ETH Support", function () {
    const ETH_ADDRESS = ethers.ZeroAddress;

    it("Should create pool with ETH and ERC20 token", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("1.0"); // 1 ETH
      const tokenAmount = ethers.parseUnits("2000", 18);

      // Mint tokens
      await tokenA.mint(deployer.address, tokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount);

      // Create pool with ETH and token
      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx.wait();

      // Verify pool exists
      const pool = await amm.getPool(poolId);
      expect(pool.token0).to.equal(ETH_ADDRESS); // ETH should be token0 (address(0) < tokenA)
      expect(pool.reserve0).to.equal(ethAmount);
      expect(pool.reserve1).to.equal(tokenAmount);
    });

    it("Should add liquidity to ETH/ERC20 pool", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("1.0");
      const tokenAmount = ethers.parseUnits("2000", 18);

      // Setup and create pool
      await tokenA.mint(deployer.address, tokenAmount * 2n);
      await tokenA.approve(await amm.getAddress(), tokenAmount * 2n);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Add more liquidity
      const tx2 = await amm.addLiquidity(
        poolId,
        ethAmount,
        tokenAmount,
        { value: ethAmount }
      );
      await tx2.wait();

      // Verify reserves increased
      const pool = await amm.getPool(poolId);
      expect(pool.reserve0).to.equal(ethAmount * 2n);
      expect(pool.reserve1).to.equal(tokenAmount * 2n);
    });

    it("Should remove liquidity from ETH/ERC20 pool", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("1.0");
      const tokenAmount = ethers.parseUnits("2000", 18);

      // Setup and create pool
      await tokenA.mint(deployer.address, tokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Get LP balance
      const lpBalance = await amm.getLpBalance(poolId, deployer.address);
      expect(lpBalance).to.be.greaterThan(0);

      // Get initial balances
      const initialEthBalance = await ethers.provider.getBalance(deployer.address);
      const initialTokenBalance = await tokenA.balanceOf(deployer.address);

      // Remove liquidity
      const removeAmount = lpBalance / 2n;
      const tx2 = await amm.removeLiquidity(poolId, removeAmount);
      const receipt = await tx2.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      // Verify balances changed
      const finalEthBalance = await ethers.provider.getBalance(deployer.address);
      const finalTokenBalance = await tokenA.balanceOf(deployer.address);

      // ETH balance should increase (accounting for gas)
      expect(finalEthBalance + gasUsed).to.be.greaterThan(initialEthBalance);
      expect(finalTokenBalance).to.be.greaterThan(initialTokenBalance);
    });

    it("Should swap ETH for ERC20 token", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("10.0");
      const tokenAmount = ethers.parseUnits("20000", 18);
      const swapEthAmount = ethers.parseEther("1.0");

      // Setup and create pool
      await tokenA.mint(deployer.address, tokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Get initial balances
      const initialEthBalance = await ethers.provider.getBalance(deployer.address);
      const initialTokenBalance = await tokenA.balanceOf(deployer.address);

      // Execute swap: ETH -> Token
      const tx2 = await amm.swap(
        poolId,
        ETH_ADDRESS,
        swapEthAmount,
        0,
        deployer.address,
        { value: swapEthAmount }
      );
      const receipt = await tx2.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      // Verify balances changed
      const finalEthBalance = await ethers.provider.getBalance(deployer.address);
      const finalTokenBalance = await tokenA.balanceOf(deployer.address);

      // ETH should decrease (accounting for gas and swap amount)
      expect(finalEthBalance + gasUsed + swapEthAmount).to.be.closeTo(initialEthBalance, ethers.parseEther("0.01"));
      // Token balance should increase
      expect(finalTokenBalance).to.be.greaterThan(initialTokenBalance);
    });

    it("Should swap ERC20 token for ETH", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("10.0");
      const tokenAmount = ethers.parseUnits("20000", 18);
      const swapTokenAmount = ethers.parseUnits("1000", 18);

      // Setup and create pool
      await tokenA.mint(deployer.address, tokenAmount + swapTokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount + swapTokenAmount);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Get initial balances
      const initialEthBalance = await ethers.provider.getBalance(deployer.address);
      const initialTokenBalance = await tokenA.balanceOf(deployer.address);

      // Execute swap: Token -> ETH
      const tx2 = await amm.swap(
        poolId,
        await tokenA.getAddress(),
        swapTokenAmount,
        0,
        deployer.address
      );
      const receipt = await tx2.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      // Verify balances changed
      const finalEthBalance = await ethers.provider.getBalance(deployer.address);
      const finalTokenBalance = await tokenA.balanceOf(deployer.address);

      // ETH should increase (accounting for gas)
      expect(finalEthBalance + gasUsed).to.be.greaterThan(initialEthBalance);
      // Token balance should decrease
      expect(finalTokenBalance).to.equal(initialTokenBalance - swapTokenAmount);
    });

    it("Should reject creating pool with both tokens as ETH", async function () {
      const { amm, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("1.0");

      await expect(
        amm.createPool(
          ETH_ADDRESS,
          ETH_ADDRESS,
          ethAmount,
          ethAmount,
          0,
          { value: ethAmount * 2n }
        )
      ).to.be.revertedWith("both ETH");
    });

    it("Should reject createPool with incorrect ETH amount", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("1.0");
      const tokenAmount = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, tokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount);

      // Try to create pool with wrong ETH amount
      await expect(
        amm.createPool(
          ETH_ADDRESS,
          await tokenA.getAddress(),
          ethAmount,
          tokenAmount,
          0,
          { value: ethAmount / 2n } // Wrong amount
        )
      ).to.be.revertedWith("ETH amount mismatch");
    });

    it("Should reject addLiquidity with incorrect ETH amount", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("1.0");
      const tokenAmount = ethers.parseUnits("2000", 18);

      await tokenA.mint(deployer.address, tokenAmount * 2n);
      await tokenA.approve(await amm.getAddress(), tokenAmount * 2n);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Try to add liquidity with wrong ETH amount
      await expect(
        amm.addLiquidity(
          poolId,
          ethAmount,
          tokenAmount,
          { value: ethAmount / 2n } // Wrong amount
        )
      ).to.be.revertedWith("ETH amount mismatch");
    });

    it("Should reject swap with incorrect ETH amount", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("10.0");
      const tokenAmount = ethers.parseUnits("20000", 18);
      const swapEthAmount = ethers.parseEther("1.0");

      await tokenA.mint(deployer.address, tokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Try to swap with wrong ETH amount
      await expect(
        amm.swap(
          poolId,
          ETH_ADDRESS,
          swapEthAmount,
          0,
          deployer.address,
          { value: swapEthAmount / 2n } // Wrong amount
        )
      ).to.be.revertedWith("ETH amount mismatch");
    });

    it("Should reject swap ERC20 with unexpected ETH", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      const ethAmount = ethers.parseEther("10.0");
      const tokenAmount = ethers.parseUnits("20000", 18);
      const swapTokenAmount = ethers.parseUnits("1000", 18);

      await tokenA.mint(deployer.address, tokenAmount + swapTokenAmount);
      await tokenA.approve(await amm.getAddress(), tokenAmount + swapTokenAmount);

      const poolId = await amm.getPoolId(ETH_ADDRESS, await tokenA.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        ETH_ADDRESS,
        await tokenA.getAddress(),
        ethAmount,
        tokenAmount,
        0,
        { value: ethAmount }
      );
      await tx1.wait();

      // Try to swap token but send ETH
      await expect(
        amm.swap(
          poolId,
          await tokenA.getAddress(),
          swapTokenAmount,
          0,
          deployer.address,
          { value: ethers.parseEther("0.1") } // Unexpected ETH
        )
      ).to.be.revertedWith("unexpected ETH");
    });
  });

  describe("Issue #10: Multi-hop Swaps", function () {
    it("Should execute 2-hop swap (TokenA -> TokenB -> TokenC)", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      // Deploy third token
      const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
      const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
      await tokenC.waitForDeployment();

      const amountA = ethers.parseUnits("1000", 18);
      const amountB = ethers.parseUnits("2000", 18);
      const amountC = ethers.parseUnits("3000", 18);
      const swapAmount = ethers.parseUnits("100", 18);

      // Setup tokens
      await tokenA.mint(deployer.address, amountA + swapAmount);
      await tokenB.mint(deployer.address, amountB * 2n);
      await tokenC.mint(deployer.address, amountC);

      await tokenA.approve(await amm.getAddress(), amountA + swapAmount);
      await tokenB.approve(await amm.getAddress(), amountB * 2n);
      await tokenC.approve(await amm.getAddress(), amountC);

      // Create pool A-B
      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tx1 = await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );
      await tx1.wait();

      // Create pool B-C
      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      const tx2 = await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );
      await tx2.wait();

      // Get initial balances
      const initialBalanceA = await tokenA.balanceOf(deployer.address);
      const initialBalanceC = await tokenC.balanceOf(deployer.address);

      // Execute multi-hop swap: A -> B -> C
      const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];
      const poolIds = [poolIdAB, poolIdBC];

      const tx3 = await amm.swapMultiHop(path, poolIds, swapAmount, 0, deployer.address);
      const receipt = await tx3.wait();

      // Verify balances changed
      const finalBalanceA = await tokenA.balanceOf(deployer.address);
      const finalBalanceC = await tokenC.balanceOf(deployer.address);

      expect(finalBalanceA).to.equal(initialBalanceA - swapAmount);
      expect(finalBalanceC).to.be.greaterThan(initialBalanceC);

      // Verify events were emitted
      const swapEvents = receipt!.logs.filter(
        (log: any) => log.fragment && log.fragment.name === "Swap"
      );
      expect(swapEvents.length).to.equal(2); // Two hops

      const multiHopEvent = receipt!.logs.find(
        (log: any) => log.fragment && log.fragment.name === "MultiHopSwap"
      );
      expect(multiHopEvent).to.not.be.undefined;
    });

    it("Should execute 3-hop swap (TokenA -> TokenB -> TokenC -> TokenD)", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      // Deploy third and fourth tokens
      const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
      const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
      await tokenC.waitForDeployment();
      const tokenD = await MockTokenFactory.deploy("TokenD", "TKD", 18);
      await tokenD.waitForDeployment();

      const amount = ethers.parseUnits("1000", 18);
      const swapAmount = ethers.parseUnits("50", 18);

      // Setup tokens
      await tokenA.mint(deployer.address, amount + swapAmount);
      await tokenB.mint(deployer.address, amount * 2n);
      await tokenC.mint(deployer.address, amount * 2n);
      await tokenD.mint(deployer.address, amount);

      await tokenA.approve(await amm.getAddress(), amount + swapAmount);
      await tokenB.approve(await amm.getAddress(), amount * 2n);
      await tokenC.approve(await amm.getAddress(), amount * 2n);
      await tokenD.approve(await amm.getAddress(), amount);

      // Create pools
      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amount, amount, 0);

      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(await tokenB.getAddress(), await tokenC.getAddress(), amount, amount, 0);

      const poolIdCD = await amm.getPoolId(await tokenC.getAddress(), await tokenD.getAddress(), FEE_BPS);
      await amm.createPool(await tokenC.getAddress(), await tokenD.getAddress(), amount, amount, 0);

      // Get initial balances
      const initialBalanceA = await tokenA.balanceOf(deployer.address);
      const initialBalanceD = await tokenD.balanceOf(deployer.address);

      // Execute 3-hop swap: A -> B -> C -> D
      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        await tokenD.getAddress()
      ];
      const poolIds = [poolIdAB, poolIdBC, poolIdCD];

      const tx = await amm.swapMultiHop(path, poolIds, swapAmount, 0, deployer.address);
      const receipt = await tx.wait();

      // Verify balances
      const finalBalanceA = await tokenA.balanceOf(deployer.address);
      const finalBalanceD = await tokenD.balanceOf(deployer.address);

      expect(finalBalanceA).to.equal(initialBalanceA - swapAmount);
      expect(finalBalanceD).to.be.greaterThan(initialBalanceD);

      // Verify 3 Swap events were emitted
      const swapEvents = receipt!.logs.filter(
        (log: any) => log.fragment && log.fragment.name === "Swap"
      );
      expect(swapEvents.length).to.equal(3);
    });

    it("Should enforce slippage protection on final output", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
      const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
      await tokenC.waitForDeployment();

      const amount = ethers.parseUnits("1000", 18);
      const swapAmount = ethers.parseUnits("100", 18);

      // Setup and create pools
      await tokenA.mint(deployer.address, amount + swapAmount);
      await tokenB.mint(deployer.address, amount * 2n);
      await tokenC.mint(deployer.address, amount);

      await tokenA.approve(await amm.getAddress(), amount + swapAmount);
      await tokenB.approve(await amm.getAddress(), amount * 2n);
      await tokenC.approve(await amm.getAddress(), amount);

      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amount, amount, 0);

      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(await tokenB.getAddress(), await tokenC.getAddress(), amount, amount, 0);

      const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];
      const poolIds = [poolIdAB, poolIdBC];

      // Try with unrealistic minAmountOut (should fail)
      const unrealisticMin = ethers.parseUnits("10000", 18);
      await expect(
        amm.swapMultiHop(path, poolIds, swapAmount, unrealisticMin, deployer.address)
      ).to.be.revertedWith("slippage");
    });

    it("Should reject invalid path length", async function () {
      const { amm, tokenA, deployer } = await loadFixture(deployContractsFixture);

      await expect(
        amm.swapMultiHop([await tokenA.getAddress()], [], 1000, 0, deployer.address)
      ).to.be.revertedWith("invalid path");
    });

    it("Should reject mismatched poolIds length", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      const poolIds: any[] = []; // Empty array, should have 1 poolId

      await expect(
        amm.swapMultiHop(path, poolIds, 1000, 0, deployer.address)
      ).to.be.revertedWith("invalid poolIds length");
    });

    it("Should reject invalid pool in path", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
      const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
      await tokenC.waitForDeployment();

      const amount = ethers.parseUnits("1000", 18);
      const swapAmount = ethers.parseUnits("100", 18);

      await tokenA.mint(deployer.address, amount + swapAmount);
      await tokenB.mint(deployer.address, amount);
      await tokenC.mint(deployer.address, amount);

      await tokenA.approve(await amm.getAddress(), amount + swapAmount);
      await tokenB.approve(await amm.getAddress(), amount);
      await tokenC.approve(await amm.getAddress(), amount);

      // Create only pool A-B, but try to swap A -> B -> C
      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amount, amount, 0);

      const fakePoolId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const path = [await tokenA.getAddress(), await tokenB.getAddress(), await tokenC.getAddress()];
      const poolIds = [poolIdAB, fakePoolId];

      await expect(
        amm.swapMultiHop(path, poolIds, swapAmount, 0, deployer.address)
      ).to.be.revertedWith("pool not found");
    });

    it("Should reject invalid token path in pool", async function () {
      const { amm, tokenA, tokenB, deployer } = await loadFixture(deployContractsFixture);

      const MockTokenFactory = await ethers.getContractFactory("MockToken", deployer);
      const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
      await tokenC.waitForDeployment();

      const amount = ethers.parseUnits("1000", 18);
      const swapAmount = ethers.parseUnits("100", 18);

      await tokenA.mint(deployer.address, amount + swapAmount);
      await tokenB.mint(deployer.address, amount);
      await tokenC.mint(deployer.address, amount);

      await tokenA.approve(await amm.getAddress(), amount + swapAmount);
      await tokenB.approve(await amm.getAddress(), amount);
      await tokenC.approve(await amm.getAddress(), amount);

      // Create pool A-B
      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amount, amount, 0);

      // Create pool B-C
      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(await tokenB.getAddress(), await tokenC.getAddress(), amount, amount, 0);

      // Try invalid path: A -> C -> B (pool A-B doesn't connect to C)
      const path = [await tokenA.getAddress(), await tokenC.getAddress(), await tokenB.getAddress()];
      const poolIds = [poolIdAB, poolIdBC];

      await expect(
        amm.swapMultiHop(path, poolIds, swapAmount, 0, deployer.address)
      ).to.be.revertedWith("invalid path");
    });
  });
});
