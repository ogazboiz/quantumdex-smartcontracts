import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Multi-hop Swaps", function () {
  const FEE_BPS = 30; // 0.30%

  async function deployContractsFixture() {
    const signers = await ethers.getSigners();
    const [deployer, alice] = signers;

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

    const tokenC = await MockTokenFactory.deploy("TokenC", "TKC", 18);
    await tokenC.waitForDeployment();
    const tokenCAddress = await tokenC.getAddress();

    return {
      amm,
      tokenA,
      tokenB,
      tokenC,
      deployer,
      alice,
      ammAddress,
      tokenAAddress,
      tokenBAddress,
      tokenCAddress,
    };
  }

  describe("Path Validation", function () {
    it("Should reject path with less than 3 elements", async function () {
      const { amm, alice } = await loadFixture(deployContractsFixture);
      const path = [ethers.ZeroAddress, ethers.ZeroAddress];
      
      await expect(
        amm.swapMultiHop(path, ethers.parseUnits("100", 18), 0, alice.address)
      ).to.be.revertedWithCustomError(amm, "InvalidPath");
    });

    it("Should reject path with even length", async function () {
      const { amm, alice } = await loadFixture(deployContractsFixture);
      const path = [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress];
      
      await expect(
        amm.swapMultiHop(path, ethers.parseUnits("100", 18), 0, alice.address)
      ).to.be.revertedWithCustomError(amm, "InvalidPath");
    });

    it("Should reject zero input amount", async function () {
      const { amm, tokenA, tokenB, alice } = await loadFixture(deployContractsFixture);
      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdBytes = poolId;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const path = [tokenABytes, poolIdBytes, tokenBBytes];
      
      await expect(
        amm.swapMultiHop(path, 0, 0, alice.address)
      ).to.be.revertedWith("zero input");
    });

    it("Should reject zero recipient", async function () {
      const { amm, tokenA, tokenB } = await loadFixture(deployContractsFixture);
      const poolId = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdBytes = poolId;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const path = [tokenABytes, poolIdBytes, tokenBBytes];
      
      await expect(
        amm.swapMultiHop(path, ethers.parseUnits("100", 18), 0, ethers.ZeroAddress)
      ).to.be.revertedWith("zero recipient");
    });
  });

  describe("2-Hop Swap", function () {
    it("Should execute 2-hop swap A -> B -> C", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } = await loadFixture(deployContractsFixture);

      // Setup: Create pools A-B and B-C
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      // Create pool A-B
      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0
      );

      // Create pool B-C
      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amountB,
        amountC,
        0
      );

      // Prepare swap
      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      // Build path: [tokenA, poolIdAB, tokenB, poolIdBC, tokenC]
      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdABBytes = poolIdAB;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const poolIdBCBytes = poolIdBC;
      const tokenCBytes = ethers.zeroPadValue(await tokenC.getAddress(), 32);
      const path = [tokenABytes, poolIdABBytes, tokenBBytes, poolIdBCBytes, tokenCBytes];

      const initialBalanceC = await tokenC.balanceOf(alice.address);

      // Execute multi-hop swap
      const tx = await amm.connect(alice).swapMultiHop(path, swapAmount, 0, alice.address);
      await tx.wait();

      const finalBalanceC = await tokenC.balanceOf(alice.address);
      expect(finalBalanceC).to.be.greaterThan(initialBalanceC);
    });

    it("Should handle slippage protection in 2-hop swap", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } = await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, 0);

      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(await tokenB.getAddress(), await tokenC.getAddress(), amountB, amountC, 0);

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdABBytes = poolIdAB;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const poolIdBCBytes = poolIdBC;
      const tokenCBytes = ethers.zeroPadValue(await tokenC.getAddress(), 32);
      const path = [tokenABytes, poolIdABBytes, tokenBBytes, poolIdBCBytes, tokenCBytes];

      // Set unrealistic minAmountOut (should fail)
      const unrealisticMin = ethers.parseUnits("1000000", 18);

      await expect(
        amm.connect(alice).swapMultiHop(path, swapAmount, unrealisticMin, alice.address)
      ).to.be.revertedWith("slippage");
    });
  });

  describe("Invalid Pool Tests", function () {
    it("Should reject swap with non-existent pool", async function () {
      const { amm, tokenA, tokenB, alice } = await loadFixture(deployContractsFixture);
      const fakePoolId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const path = [tokenABytes, fakePoolId, tokenBBytes];

      await tokenA.mint(alice.address, ethers.parseUnits("100", 18));
      await tokenA.connect(alice).approve(await amm.getAddress(), ethers.parseUnits("100", 18));

      await expect(
        amm.connect(alice).swapMultiHop(path, ethers.parseUnits("100", 18), 0, alice.address)
      ).to.be.revertedWithCustomError(amm, "InvalidPool");
    });

    it("Should reject swap with invalid token path", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } = await loadFixture(deployContractsFixture);

      // Create pool A-B
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      await tokenA.mint(deployer.address, amountA);
      await tokenB.mint(deployer.address, amountB);
      await tokenA.approve(await amm.getAddress(), amountA);
      await tokenB.approve(await amm.getAddress(), amountB);

      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, 0);

      // Try to swap A -> B -> C but pool B-C doesn't exist
      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdABBytes = poolIdAB;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const fakePoolIdBC = ethers.keccak256(ethers.toUtf8Bytes("fake"));
      const tokenCBytes = ethers.zeroPadValue(await tokenC.getAddress(), 32);
      const path = [tokenABytes, poolIdABBytes, tokenBBytes, fakePoolIdBC, tokenCBytes];

      await tokenA.mint(alice.address, ethers.parseUnits("100", 18));
      await tokenA.connect(alice).approve(await amm.getAddress(), ethers.parseUnits("100", 18));

      await expect(
        amm.connect(alice).swapMultiHop(path, ethers.parseUnits("100", 18), 0, alice.address)
      ).to.be.revertedWithCustomError(amm, "InvalidPool");
    });
  });

  describe("Event Emissions", function () {
    it("Should emit Swap events for each hop", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } = await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, 0);

      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(await tokenB.getAddress(), await tokenC.getAddress(), amountB, amountC, 0);

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdABBytes = poolIdAB;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const poolIdBCBytes = poolIdBC;
      const tokenCBytes = ethers.zeroPadValue(await tokenC.getAddress(), 32);
      const path = [tokenABytes, poolIdABBytes, tokenBBytes, poolIdBCBytes, tokenCBytes];

      const tx = await amm.connect(alice).swapMultiHop(path, swapAmount, 0, alice.address);
      const receipt = await tx.wait();

      // Check that Swap events were emitted
      const swapEvents = receipt.logs.filter(log => {
        try {
          const parsed = amm.interface.parseLog(log);
          return parsed && parsed.name === "Swap";
        } catch {
          return false;
        }
      });
      expect(swapEvents.length).to.be.greaterThan(0);
    });

    it("Should emit MultiHopSwap event", async function () {
      const { amm, tokenA, tokenB, tokenC, deployer, alice } = await loadFixture(deployContractsFixture);

      // Setup pools
      const amountA = ethers.parseUnits("10000", 18);
      const amountB = ethers.parseUnits("20000", 18);
      const amountC = ethers.parseUnits("30000", 18);

      await tokenA.mint(deployer.address, amountA * 2n);
      await tokenB.mint(deployer.address, amountB * 3n);
      await tokenC.mint(deployer.address, amountC * 2n);

      await tokenA.approve(await amm.getAddress(), amountA * 2n);
      await tokenB.approve(await amm.getAddress(), amountB * 3n);
      await tokenC.approve(await amm.getAddress(), amountC * 2n);

      const poolIdAB = await amm.getPoolId(await tokenA.getAddress(), await tokenB.getAddress(), FEE_BPS);
      await amm.createPool(await tokenA.getAddress(), await tokenB.getAddress(), amountA, amountB, 0);

      const poolIdBC = await amm.getPoolId(await tokenB.getAddress(), await tokenC.getAddress(), FEE_BPS);
      await amm.createPool(await tokenB.getAddress(), await tokenC.getAddress(), amountB, amountC, 0);

      const swapAmount = ethers.parseUnits("100", 18);
      await tokenA.mint(alice.address, swapAmount);
      await tokenA.connect(alice).approve(await amm.getAddress(), swapAmount);

      const tokenABytes = ethers.zeroPadValue(await tokenA.getAddress(), 32);
      const poolIdABBytes = poolIdAB;
      const tokenBBytes = ethers.zeroPadValue(await tokenB.getAddress(), 32);
      const poolIdBCBytes = poolIdBC;
      const tokenCBytes = ethers.zeroPadValue(await tokenC.getAddress(), 32);
      const path = [tokenABytes, poolIdABBytes, tokenBBytes, poolIdBCBytes, tokenCBytes];

      await expect(
        amm.connect(alice).swapMultiHop(path, swapAmount, 0, alice.address)
      ).to.emit(amm, "MultiHopSwap");
    });
  });
});

