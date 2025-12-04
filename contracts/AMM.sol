// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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

    // Minimum liquidity to lock forever on first pool creation
    // This prevents pool drainage attacks by ensuring some liquidity always remains
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
        require(tokenA != address(0) && tokenB != address(0), "zero address");
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        poolId = keccak256(abi.encodePacked(token0, token1, feeBps));
    }

    function createPool(
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) external nonReentrant returns (bytes32 poolId, uint256 liquidity) {
        require(amountA > 0 && amountB > 0, "insufficient amounts");

        uint16 feeBps = defaultFeeBps;
        require(tokenA != tokenB, "identical tokens");
        require(tokenA != address(0) && tokenB != address(0), "zero address");

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

        liquidity = _sqrt(amount0 * amount1);
        require(liquidity > MINIMUM_LIQUIDITY, "insufficient liquidity");

        // Lock MINIMUM_LIQUIDITY forever by sending to address(0)
        // This prevents the last LP from draining the pool completely
        uint256 lockedLiquidity = MINIMUM_LIQUIDITY;
        uint256 userLiquidity = liquidity - lockedLiquidity;

        pool.token0 = token0;
        pool.token1 = token1;
        pool.reserve0 = uint112(amount0);
        pool.reserve1 = uint112(amount1);
        pool.feeBps = feeBps;
        pool.totalSupply = liquidity; // totalSupply includes locked liquidity
        pool.exists = true;
        pool.balanceOf[address(0)] = lockedLiquidity; // Lock to zero address
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

        emit LiquidityAdded(poolId, msg.sender, liquidity, amount0, amount1);
    }

    function addLiquidity(
        bytes32 poolId,
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external nonReentrant returns (uint256 liquidity, uint256 amount0, uint256 amount1) {
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

        pool.balanceOf[msg.sender] = balance - liquidity;
        pool.totalSupply = _totalSupply - liquidity;
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
    ) external nonReentrant returns (uint256 amountOut) {
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
        require(IERC20(token).transfer(to, value), "transfer failed");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        require(IERC20(token).transferFrom(from, to, value), "transferFrom failed");
    }
}
