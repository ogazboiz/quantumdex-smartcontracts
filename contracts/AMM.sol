// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title Automated Market Maker (AMM) Contract
/// @notice Implements a constant product market maker (x * y = k) with liquidity provision
/// @dev Security Features:
///      - Minimum liquidity lock prevents pool drainage attacks
///      - ReentrancyGuard protects against reentrancy attacks
///      - Ownable pattern for access control
contract AMM is ReentrancyGuard, Ownable {
    struct Pool {
        address token0;
        address token1;
        uint112 reserve0;
        uint112 reserve1;
        uint16 feeBps;
        uint256 totalSupply;
        bool exists;
        mapping(address => uint256) balanceOf;
    }

    // poolId => Pool
    mapping(bytes32 => Pool) private pools;

    // Global default fee in basis points (e.g., 30 = 0.30%)
    uint16 public immutable defaultFeeBps;

    /// @notice Address representing native ETH
    /// @dev address(0) is used to represent native ETH in token addresses
    address private constant ETH = address(0);

    /// @notice Minimum liquidity to lock forever on first pool creation
    /// @dev This prevents pool drainage attacks by ensuring some liquidity always remains.
    /// The locked liquidity is sent to address(0) and can never be removed.
    /// This is a critical security feature that prevents the last LP from draining the pool completely.
    /// The value of 1000 is chosen to be small enough to not significantly impact users,
    /// but large enough to prevent rounding errors and ensure pool stability.
    uint256 private constant MINIMUM_LIQUIDITY = 1000;

    event PoolCreated(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        uint16 feeBps,
        uint256 initialLiquidity,
        uint256 amount0,
        uint256 amount1,
        address provider
    );

    event LiquidityAdded(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 liquidityMinted,
        uint256 amount0,
        uint256 amount1
    );

    event LiquidityRemoved(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 liquidityBurned,
        uint256 amount0,
        uint256 amount1
    );

    event Swap(
        bytes32 indexed poolId,
        address indexed sender,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    event MultiHopSwap(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    constructor(uint16 _defaultFeeBps) Ownable(msg.sender) {
        require(_defaultFeeBps <= 1000, "fee too high");
        defaultFeeBps = _defaultFeeBps;
    }

    function getPool(
        bytes32 poolId
    ) external view returns (
        address token0,
        address token1,
        uint112 reserve0,
        uint112 reserve1,
        uint16 feeBps,
        uint256 totalSupply
    ) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "pool not found");
        return (
            pool.token0,
            pool.token1,
            pool.reserve0,
            pool.reserve1,
            pool.feeBps,
            pool.totalSupply
        );
    }

    function getLpBalance(bytes32 poolId, address account) external view returns (uint256) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "pool not found");
        return pool.balanceOf[account];
    }

    function getPoolId(
        address tokenA,
        address tokenB,
        uint16 feeBps
    ) public pure returns (bytes32 poolId) {
        require(tokenA != tokenB, "identical tokens");
        // Allow address(0) for ETH, but both cannot be ETH
        require(!(tokenA == ETH && tokenB == ETH), "both ETH");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        poolId = keccak256(abi.encodePacked(token0, token1, feeBps));
    }

    /// @notice Creates a new liquidity pool for a token pair
    /// @dev On first liquidity provision, MINIMUM_LIQUIDITY is locked forever to address(0)
    /// to prevent pool drainage attacks. The user receives liquidity minus MINIMUM_LIQUIDITY.
    /// Supports native ETH using address(0) as token address. When using ETH, send ETH with the transaction.
    /// @param tokenA First token address (use address(0) for native ETH)
    /// @param tokenB Second token address (use address(0) for native ETH)
    /// @param amountA Amount of tokenA to provide (must match msg.value if tokenA is ETH)
    /// @param amountB Amount of tokenB to provide (must match msg.value if tokenB is ETH)
    /// @param feeBps Optional custom fee in basis points (1-1000). If 0, uses defaultFeeBps.
    /// @return poolId The unique identifier for the pool
    /// @return liquidity The amount of liquidity tokens minted (excluding locked portion)
    function createPool(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint16 feeBps
    ) external payable nonReentrant returns (bytes32 poolId, uint256 liquidity) {
        require(amountA > 0 && amountB > 0, "insufficient amounts");

        // Use provided feeBps if non-zero, otherwise use defaultFeeBps
        if (feeBps == 0) {
            feeBps = defaultFeeBps;
        }
        // Validate fee is within acceptable range (1-1000 basis points)
        require(feeBps > 0 && feeBps <= 1000, "invalid fee");
        // Allow address(0) for ETH, but both cannot be ETH (check before identical tokens)
        require(!(tokenA == ETH && tokenB == ETH), "both ETH");
        require(tokenA != tokenB, "identical tokens");

        // Validate ETH amount matches msg.value
        uint256 expectedEth = 0;
        if (tokenA == ETH) expectedEth += amountA;
        if (tokenB == ETH) expectedEth += amountB;
        require(msg.value == expectedEth, "ETH amount mismatch");

        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        (uint256 amount0, uint256 amount1) = tokenA < tokenB
            ? (amountA, amountB)
            : (amountB, amountA);

        poolId = keccak256(abi.encodePacked(token0, token1, feeBps));
        Pool storage pool = pools[poolId];
        require(!pool.exists, "pool exists");

        _safeTransferFrom(token0, msg.sender, address(this), amount0);
        _safeTransferFrom(token1, msg.sender, address(this), amount1);

        // Calculate liquidity using constant product formula: sqrt(x * y)
        liquidity = _sqrt(amount0 * amount1);
        // Use strict greater than to ensure we can subtract MINIMUM_LIQUIDITY
        // If liquidity equals MINIMUM_LIQUIDITY, user would receive 0, which is invalid
        require(liquidity > MINIMUM_LIQUIDITY, "insufficient liquidity");

        // Lock MINIMUM_LIQUIDITY forever by assigning to address(0)
        // This prevents the last LP from draining the pool completely.
        // Formula: userLiquidity = sqrt(x * y) - MINIMUM_LIQUIDITY
        // The locked liquidity ensures the pool always has a minimum reserve
        uint256 lockedLiquidity = MINIMUM_LIQUIDITY;
        uint256 userLiquidity = liquidity - lockedLiquidity;

        pool.token0 = token0;
        pool.token1 = token1;
        pool.reserve0 = uint112(amount0);
        pool.reserve1 = uint112(amount1);
        pool.feeBps = feeBps;
        // totalSupply includes locked liquidity to maintain accurate accounting
        pool.totalSupply = liquidity;
        pool.exists = true;
        // Lock MINIMUM_LIQUIDITY to address(0) - this can never be removed
        pool.balanceOf[address(0)] = lockedLiquidity;
        // User receives liquidity minus the locked portion
        pool.balanceOf[msg.sender] = userLiquidity;

        emit PoolCreated(
            poolId,
            token0,
            token1,
            feeBps,
            liquidity,
            amount0,
            amount1,
            msg.sender
        );

        emit LiquidityAdded(poolId, msg.sender, userLiquidity, amount0, amount1);
    }

    function addLiquidity(
        bytes32 poolId,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external payable nonReentrant returns (uint256 liquidity, uint256 amount0, uint256 amount1) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "pool not found");
        require(amount0Desired > 0 && amount1Desired > 0, "insufficient amounts");

        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        require(reserve0 > 0 && reserve1 > 0, "no reserves");

        uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
        if (amount1Optimal <= amount1Desired) {
            amount0 = amount0Desired;
            amount1 = amount1Optimal;
        } else {
            uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
            require(amount0Optimal <= amount0Desired, "invalid liquidity ratio");
            amount0 = amount0Optimal;
            amount1 = amount1Desired;
        }

        // Validate ETH amount matches msg.value
        uint256 expectedEth = 0;
        if (pool.token0 == ETH) expectedEth += amount0;
        if (pool.token1 == ETH) expectedEth += amount1;
        require(msg.value == expectedEth, "ETH amount mismatch");

        _safeTransferFrom(pool.token0, msg.sender, address(this), amount0);
        _safeTransferFrom(pool.token1, msg.sender, address(this), amount1);

        uint256 _totalSupply = pool.totalSupply;
        liquidity = _min(
            (amount0 * _totalSupply) / reserve0,
            (amount1 * _totalSupply) / reserve1
        );
        require(liquidity > 0, "insufficient liquidity minted");

        pool.totalSupply = _totalSupply + liquidity;
        pool.balanceOf[msg.sender] += liquidity;
        pool.reserve0 = uint112(uint256(reserve0) + amount0);
        pool.reserve1 = uint112(uint256(reserve1) + amount1);

        emit LiquidityAdded(poolId, msg.sender, liquidity, amount0, amount1);
    }

    /// @notice Removes liquidity from a pool
    /// @dev Prevents removing liquidity that would leave the pool below MINIMUM_LIQUIDITY.
    /// This ensures the locked liquidity protection remains effective.
    /// @param poolId The pool identifier
    /// @param liquidity Amount of liquidity tokens to burn
    /// @return amount0 Amount of token0 received
    /// @return amount1 Amount of token1 received
    function removeLiquidity(
        bytes32 poolId,
        uint256 liquidity
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Pool storage pool = pools[poolId];
        require(pool.exists, "pool not found");
        require(liquidity > 0, "zero liquidity");

        uint256 balance = pool.balanceOf[msg.sender];
        require(balance >= liquidity, "insufficient lp balance");

        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        uint256 _totalSupply = pool.totalSupply;

        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;
        require(amount0 > 0 && amount1 > 0, "insufficient amounts");

        // Prevent removing liquidity that would leave pool below MINIMUM_LIQUIDITY
        // This ensures the locked liquidity protection remains effective.
        // The check uses >= to allow removal down to exactly MINIMUM_LIQUIDITY,
        // but never below it, preserving the security guarantee.
        uint256 remainingSupply = _totalSupply - liquidity;
        require(remainingSupply >= MINIMUM_LIQUIDITY, "insufficient liquidity");

        pool.balanceOf[msg.sender] = balance - liquidity;
        pool.totalSupply = remainingSupply;
        pool.reserve0 = uint112(uint256(reserve0) - amount0);
        pool.reserve1 = uint112(uint256(reserve1) - amount1);

        _safeTransfer(pool.token0, msg.sender, amount0);
        _safeTransfer(pool.token1, msg.sender, amount1);

        emit LiquidityRemoved(poolId, msg.sender, liquidity, amount0, amount1);
    }

    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external payable nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "zero input");
        require(recipient != address(0), "zero recipient");

        Pool storage pool = pools[poolId];
        require(pool.exists, "pool not found");

        bool zeroForOne;
        if (tokenIn == pool.token0) {
            zeroForOne = true;
        } else if (tokenIn == pool.token1) {
            zeroForOne = false;
        } else {
            revert("invalid tokenIn");
        }

        // Validate ETH amount matches msg.value if tokenIn is ETH
        if (tokenIn == ETH) {
            require(msg.value == amountIn, "ETH amount mismatch");
        } else {
            require(msg.value == 0, "unexpected ETH");
        }

        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        require(reserve0 > 0 && reserve1 > 0, "no reserves");

        uint256 amountInWithFee = (amountIn * (10000 - pool.feeBps)) / 10000;

        if (zeroForOne) {
            amountOut = _getAmountOut(amountInWithFee, reserve0, reserve1);
            require(amountOut >= minAmountOut, "slippage");

            pool.reserve0 = uint112(uint256(reserve0) + amountIn);
            pool.reserve1 = uint112(uint256(reserve1) - amountOut);
            _safeTransfer(pool.token1, recipient, amountOut);
        } else {
            amountOut = _getAmountOut(amountInWithFee, reserve1, reserve0);
            require(amountOut >= minAmountOut, "slippage");

            pool.reserve1 = uint112(uint256(reserve1) + amountIn);
            pool.reserve0 = uint112(uint256(reserve0) - amountOut);
            _safeTransfer(pool.token0, recipient, amountOut);
        }

        emit Swap(poolId, msg.sender, tokenIn, amountIn, amountOut, recipient);
    }

    /// @notice Execute a multi-hop swap through multiple pools
    /// @dev Path format: [tokenIn, poolId1, tokenMid, poolId2, tokenOut, ...]
    /// @param path Array alternating between tokens and poolIds
    /// @param amountIn Amount of input token
    /// @param minAmountOut Minimum amount of output token (slippage protection)
    /// @param recipient Address to receive output tokens
    /// @return amountOut Amount of output token received
    function swapMultiHop(
        address[] calldata path,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external payable nonReentrant returns (uint256 amountOut) {
        // TODO: Implement multi-hop swap logic
        revert("Not implemented");
    }

    function _getAmountOut(
        uint256 amountIn,
        uint112 reserveIn,
        uint112 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, "insufficient input");
        require(reserveIn > 0 && reserveOut > 0, "insufficient liquidity");
        uint256 numerator = uint256(amountIn) * reserveOut;
        uint256 denominator = uint256(reserveIn) + amountIn;
        amountOut = numerator / denominator;
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        if (token == ETH) {
            (bool success, ) = payable(to).call{value: value}("");
            require(success, "ETH transfer failed");
        } else {
            require(IERC20(token).transfer(to, value), "transfer failed");
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        if (token == ETH) {
            // For ETH, the value should already be in the contract via msg.value
            // We just need to verify the contract has enough balance
            require(address(this).balance >= value, "insufficient ETH balance");
        } else {
            require(IERC20(token).transferFrom(from, to, value), "transferFrom failed");
        }
    }
}
