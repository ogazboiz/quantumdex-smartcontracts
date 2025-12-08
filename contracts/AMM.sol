// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Interface for flash loan callback
/// @dev Contracts that want to receive flash loans must implement this interface
interface IFlashLoanReceiver {
    /// @notice Called after receiving flash loan tokens
    /// @param token Address of the token borrowed
    /// @param amount Amount of tokens borrowed
    /// @param fee Fee amount that must be repaid
    /// @param data Additional data passed to the flash loan
    function onFlashLoan(
        address token,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external;
}

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

    /// @notice Flash loan fee in basis points (9 = 0.09%)
    /// @dev Standard flash loan fee rate used by major protocols
    uint16 private constant FLASH_LOAN_FEE_BPS = 9;

    // Custom errors for gas optimization (replaces require strings)
    error FeeTooHigh();
    error PoolNotFound();
    error IdenticalTokens();
    error BothETH();
    error InsufficientAmounts();
    error InvalidFee();
    error ETHAmountMismatch();
    error PoolExists();
    error InsufficientLiquidity();
    error ZeroInput();
    error ZeroRecipient();
    error InvalidTokenIn();
    error UnexpectedETH();
    error NoReserves();
    error SlippageExceeded();
    error ZeroLiquidity();
    error InsufficientLpBalance();
    error InsufficientAmountsOut();
    error ZeroAmount();
    error InvalidToken();
    error InsufficientLiquidityForFlashLoan();
    error InvalidPath();
    error InvalidPathLength();
    error InvalidPool();
    error ZeroOutput();
    error TransferFailed();
    error InsufficientETHBalance();
    // Flash loan errors
    error FlashLoanNotRepaid();
    error FlashLoanInsufficientBalance();
    error FlashLoanInvalidReceiver();

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
        address[] path,
        bytes32[] poolIds,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    event FlashLoan(
        bytes32 indexed poolId,
        address indexed token,
        address indexed borrower,
        uint256 amount,
        uint256 fee
    );

    constructor(uint16 _defaultFeeBps) Ownable(msg.sender) {
        if (_defaultFeeBps > 1000) revert FeeTooHigh();
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
        if (!pool.exists) revert PoolNotFound();
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
        if (!pool.exists) revert PoolNotFound();
        return pool.balanceOf[account];
    }

    function getPoolId(
        address tokenA,
        address tokenB,
        uint16 feeBps
    ) public pure returns (bytes32 poolId) {
        if (tokenA == tokenB) revert IdenticalTokens();
        // Allow address(0) for ETH, but both cannot be ETH
        if (tokenA == ETH && tokenB == ETH) revert BothETH();
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
        if (amountA == 0 || amountB == 0) revert InsufficientAmounts();

        // Use provided feeBps if non-zero, otherwise use defaultFeeBps
        if (feeBps == 0) {
            feeBps = defaultFeeBps;
        }
        // Validate fee is within acceptable range (1-1000 basis points)
        if (feeBps == 0 || feeBps > 1000) revert InvalidFee();
        // Allow address(0) for ETH, but both cannot be ETH (check before identical tokens)
        if (tokenA == ETH && tokenB == ETH) revert BothETH();
        if (tokenA == tokenB) revert IdenticalTokens();

        // Validate ETH amount matches msg.value
        uint256 expectedEth = 0;
        if (tokenA == ETH) expectedEth += amountA;
        if (tokenB == ETH) expectedEth += amountB;
        if (msg.value != expectedEth) revert ETHAmountMismatch();

        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        (uint256 amount0, uint256 amount1) = tokenA < tokenB
            ? (amountA, amountB)
            : (amountB, amountA);

        poolId = keccak256(abi.encodePacked(token0, token1, feeBps));
        Pool storage pool = pools[poolId];
        if (pool.exists) revert PoolExists();

        _safeTransferFrom(token0, msg.sender, address(this), amount0);
        _safeTransferFrom(token1, msg.sender, address(this), amount1);

        // Calculate liquidity using constant product formula: sqrt(x * y)
        liquidity = _sqrt(amount0 * amount1);
        // Use strict greater than to ensure we can subtract MINIMUM_LIQUIDITY
        // If liquidity equals MINIMUM_LIQUIDITY, user would receive 0, which is invalid
        if (liquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

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
        if (!pool.exists) revert PoolNotFound();
        if (amount0Desired == 0 || amount1Desired == 0) revert InsufficientAmounts();

        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        if (reserve0 == 0 || reserve1 == 0) revert NoReserves();

        uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
        if (amount1Optimal <= amount1Desired) {
            amount0 = amount0Desired;
            amount1 = amount1Optimal;
        } else {
            uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
            if (amount0Optimal > amount0Desired) revert SlippageExceeded();
            amount0 = amount0Optimal;
            amount1 = amount1Desired;
        }

        // Validate ETH amount matches msg.value
        uint256 expectedEth = 0;
        if (pool.token0 == ETH) expectedEth += amount0;
        if (pool.token1 == ETH) expectedEth += amount1;
        if (msg.value != expectedEth) revert ETHAmountMismatch();

        _safeTransferFrom(pool.token0, msg.sender, address(this), amount0);
        _safeTransferFrom(pool.token1, msg.sender, address(this), amount1);

        uint256 _totalSupply = pool.totalSupply;
        liquidity = _min(
            (amount0 * _totalSupply) / reserve0,
            (amount1 * _totalSupply) / reserve1
        );
        if (liquidity == 0) revert ZeroLiquidity();

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
        if (!pool.exists) revert PoolNotFound();
        if (liquidity == 0) revert ZeroLiquidity();

        uint256 balance = pool.balanceOf[msg.sender];
        if (balance < liquidity) revert InsufficientLpBalance();

        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        uint256 _totalSupply = pool.totalSupply;

        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientAmountsOut();

        // Prevent removing liquidity that would leave pool below MINIMUM_LIQUIDITY
        // This ensures the locked liquidity protection remains effective.
        // The check uses >= to allow removal down to exactly MINIMUM_LIQUIDITY,
        // but never below it, preserving the security guarantee.
        uint256 remainingSupply = _totalSupply - liquidity;
        if (remainingSupply < MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

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
        if (amountIn == 0) revert ZeroInput();
        if (recipient == address(0)) revert ZeroRecipient();

        Pool storage pool = pools[poolId];
        if (!pool.exists) revert PoolNotFound();

        bool zeroForOne;
        if (tokenIn == pool.token0) {
            zeroForOne = true;
        } else if (tokenIn == pool.token1) {
            zeroForOne = false;
        } else {
            revert InvalidTokenIn();
        }

        // Validate ETH amount matches msg.value if tokenIn is ETH
        if (tokenIn == ETH) {
            if (msg.value != amountIn) revert ETHAmountMismatch();
        } else {
            if (msg.value != 0) revert UnexpectedETH();
        }

        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        if (reserve0 == 0 || reserve1 == 0) revert NoReserves();

        uint256 amountInWithFee = (amountIn * (10000 - pool.feeBps)) / 10000;

        if (zeroForOne) {
            amountOut = _getAmountOut(amountInWithFee, reserve0, reserve1);
            if (amountOut < minAmountOut) revert SlippageExceeded();

            pool.reserve0 = uint112(uint256(reserve0) + amountIn);
            pool.reserve1 = uint112(uint256(reserve1) - amountOut);
            _safeTransfer(pool.token1, recipient, amountOut);
        } else {
            amountOut = _getAmountOut(amountInWithFee, reserve1, reserve0);
            if (amountOut < minAmountOut) revert SlippageExceeded();

            pool.reserve1 = uint112(uint256(reserve1) + amountIn);
            pool.reserve0 = uint112(uint256(reserve0) - amountOut);
            _safeTransfer(pool.token0, recipient, amountOut);
        }

        emit Swap(poolId, msg.sender, tokenIn, amountIn, amountOut, recipient);
    }

    /// @notice Execute a flash loan from a pool
    /// @dev Borrows tokens from the pool, calls the receiver's callback, and verifies repayment + fee
    /// @dev Flash loan fee is 9 bps (0.09%) of the borrowed amount
    /// @dev The receiver must implement IFlashLoanReceiver interface
    /// @param poolId The pool identifier to borrow from
    /// @param token The token to borrow (must be token0 or token1 of the pool)
    /// @param amount The amount of tokens to borrow
    /// @param data Additional data to pass to the callback
    function flashLoan(
        bytes32 poolId,
        address token,
        uint256 amount,
        bytes calldata data
    ) external nonReentrant {
        require(amount > 0, "zero amount");
        
        Pool storage pool = pools[poolId];
        require(pool.exists, "pool not found");
        
        // Verify token is part of the pool
        require(token == pool.token0 || token == pool.token1, "invalid token");
        
        // Calculate fee (9 bps = 0.09%)
        uint256 fee = (amount * FLASH_LOAN_FEE_BPS) / 10000;
        uint256 repayAmount = amount + fee;
        
        // Get initial balance
        uint256 balanceBefore = _getBalance(token);
        
        // Verify pool has sufficient liquidity
        if (token == pool.token0) {
            require(uint256(pool.reserve0) >= amount, "insufficient liquidity");
        } else {
            require(uint256(pool.reserve1) >= amount, "insufficient liquidity");
        }
        
        // Transfer tokens to borrower
        _safeTransfer(token, msg.sender, amount);
        
        // Call callback
        IFlashLoanReceiver(msg.sender).onFlashLoan(token, amount, fee, data);
        
        // Verify repayment + fee
        // We sent out 'amount', so we should receive back 'amount + fee'
        // Net change: -amount + (amount + fee) = +fee
        // Final balance should be: balanceBefore + fee
        uint256 balanceAfter = _getBalance(token);
        if (balanceAfter < balanceBefore + fee) {
            revert FlashLoanNotRepaid();
        }
        
        // Update reserves: add full repayment (amount + fee)
        // Flash loans are temporary - we don't reduce reserves when lending,
        // but we add the full repayment back, effectively increasing reserves by the fee
        if (token == pool.token0) {
            pool.reserve0 = uint112(uint256(pool.reserve0) + repayAmount);
        } else {
            pool.reserve1 = uint112(uint256(pool.reserve1) + repayAmount);
        }
        
        emit FlashLoan(poolId, token, msg.sender, amount, fee);
    }

    /// @notice Get the balance of a token held by this contract
    /// @dev Helper function for flash loan balance tracking
    /// @param token The token address (use address(0) for ETH)
    /// @return balance The balance of the token
    function _getBalance(address token) internal view returns (uint256 balance) {
        if (token == ETH) {
            return address(this).balance;
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    /// @notice Execute a multi-hop swap through multiple pools
    /// @dev Path format: [tokenIn, poolId1, tokenMid, poolId2, tokenOut, ...]
    /// @dev Path uses bytes32[] where even indices are tokens (as bytes32) and odd indices are poolIds
    /// @dev Example: [tokenA, poolIdAB, tokenB, poolIdBC, tokenC] for A->B->C swap
    /// @dev Each hop uses the previous output as input for the next swap
    /// @dev Slippage protection is applied only to the final output amount
    /// @dev Intermediate tokens are held in the contract between hops
    /// @param path Array alternating between tokens (as bytes32) and poolIds
    /// @param amountIn Amount of input token
    /// @param minAmountOut Minimum amount of output token (slippage protection)
    /// @param recipient Address to receive output tokens
    /// @return amountOut Final amount of output token received
    /// @dev Executes swaps sequentially, using output of one hop as input to the next
    /// @param path Array of token addresses [tokenA, tokenB, tokenC, ...]
    /// @param poolIds Array of pool IDs [poolId1, poolId2, ...] where poolId1 is for tokenA->tokenB, poolId2 is for tokenB->tokenC
    /// @param amountIn Amount of first token to swap
    /// @param minAmountOut Minimum amount of final token to receive (slippage protection)
    /// @param recipient Address to receive the final output token
    function swapMultiHop(
        address[] calldata path,
        bytes32[] calldata poolIds,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external payable nonReentrant returns (uint256 amountOut) {
        // Validate path and poolIds
        require(path.length >= 2, "invalid path");
        require(poolIds.length == path.length - 1, "invalid poolIds length");
        
        // Validate input amount
        if (amountIn == 0) {
            revert("zero input");
        }
        
        // Validate recipient
        if (recipient == address(0)) {
            revert("zero recipient");
        }
        
        // Calculate number of hops
        uint256 numHops = poolIds.length;
        require(numHops > 0, "invalid path");
        require(numHops <= 10, "too many hops"); // Gas limit protection (max 10 hops)
        uint256 currentAmount = amountIn;
        
        // Handle initial token transfer (only for first hop)
        address firstToken = path[0];
        if (firstToken == ETH) {
            require(msg.value == amountIn, "ETH amount mismatch");
        } else {
            require(msg.value == 0, "unexpected ETH");
            _safeTransferFrom(firstToken, msg.sender, address(this), amountIn);
        }
        
        // Execute swaps sequentially
        for (uint256 i = 0; i < numHops; i++) {
            address tokenIn = path[i];
            bytes32 poolId = poolIds[i];
            address tokenOut = path[i + 1];
            
            // Execute single hop swap
            // For intermediate hops, recipient is this contract (tokens stay in contract)
            // For final hop, recipient is the final recipient
            currentAmount = _executeHop(poolId, tokenIn, tokenOut, currentAmount, i == numHops - 1 ? recipient : address(this));
        }
        
        amountOut = currentAmount;
        require(amountOut >= minAmountOut, "slippage");
        
        // Validate final output is non-zero
        require(amountOut > 0, "zero output");
        
        // Emit MultiHopSwap event
        emit MultiHopSwap(msg.sender, path[0], path[path.length - 1], path, poolIds, amountIn, amountOut, recipient);
    }

    /// @notice Validate multi-hop swap path format
    /// @dev Path must alternate: token (as bytes32), poolId, token (as bytes32), poolId, ...
    /// @param path Array to validate
    /// @return isValid True if path format is valid
    function _validatePath(bytes32[] calldata path) internal pure returns (bool isValid) {
        // Path must have at least 3 elements and be odd length
        if (path.length < 3 || path.length % 2 == 0) {
            return false;
        }
        return true;
    }

    /// @notice Execute a single hop in a multi-hop swap
    /// @dev Internal function to execute one swap in the path
    /// @param poolId Pool identifier for this hop
    /// @param tokenIn Input token address
    /// @param tokenOut Output token address
    /// @param amountIn Amount of input token
    /// @param recipient Address to receive output (contract for intermediate hops, final recipient for last hop)
    /// @return amountOut Amount of output token received
    function _executeHop(
        bytes32 poolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient
    ) internal returns (uint256 amountOut) {
        // Validate pool exists
        Pool storage pool = pools[poolId];
        if (!pool.exists) {
            revert InvalidPool();
        }
        
        // Determine swap direction and validate tokens match pool
        bool zeroForOne;
        if (tokenIn == pool.token0 && tokenOut == pool.token1) {
            zeroForOne = true;
        } else if (tokenIn == pool.token1 && tokenOut == pool.token0) {
            zeroForOne = false;
        } else {
            revert InvalidPath();
        }
        
        // Get reserves and validate
        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        require(reserve0 > 0 && reserve1 > 0, "no reserves");
        
        // Calculate amount out with fee
        uint256 amountInWithFee = (amountIn * (10000 - pool.feeBps)) / 10000;
        
        if (zeroForOne) {
            amountOut = _getAmountOut(amountInWithFee, reserve0, reserve1);
            pool.reserve0 = uint112(uint256(reserve0) + amountIn);
            pool.reserve1 = uint112(uint256(reserve1) - amountOut);
            _safeTransfer(pool.token1, recipient, amountOut);
        } else {
            amountOut = _getAmountOut(amountInWithFee, reserve1, reserve0);
            pool.reserve1 = uint112(uint256(reserve1) + amountIn);
            pool.reserve0 = uint112(uint256(reserve0) - amountOut);
            _safeTransfer(pool.token0, recipient, amountOut);
        }
        
        return amountOut;
    }

    /// @notice Internal function to execute multi-hop swap
    /// @dev Helper function to reduce stack depth
    function _executeMultiHopSwap(
        address[] calldata path,
        bytes32[] calldata poolIds,
        uint256 amountIn,
        address recipient
    ) internal returns (uint256 finalAmount) {
        uint256 currentAmount = amountIn;
        address currentToken = path[0];

        // Transfer first token from user
        _safeTransferFrom(currentToken, msg.sender, address(this), amountIn);

        // Execute each hop sequentially
        uint256 numHops = poolIds.length;
        for (uint256 i = 0; i < numHops; i++) {
            bytes32 poolId = poolIds[i];
            address nextToken = path[i + 1];
            bool isLastHop = (i == numHops - 1);

            Pool storage pool = pools[poolId];
            require(pool.exists, "pool not found");

            // Verify the pool contains currentToken and nextToken
            require(
                (pool.token0 == currentToken && pool.token1 == nextToken) ||
                (pool.token1 == currentToken && pool.token0 == nextToken),
                "invalid path"
            );

            // Execute swap for this hop
            currentAmount = _executeHop(pool, currentToken, currentAmount, isLastHop ? recipient : address(this));

            // Emit Swap event for this hop
            emit Swap(poolId, msg.sender, currentToken, i == 0 ? amountIn : currentAmount, currentAmount, isLastHop ? recipient : address(this));

            // Update for next iteration
            currentToken = nextToken;
        }

        finalAmount = currentAmount;
    }

    /// @notice Execute a single hop swap
    /// @dev Helper function to reduce stack depth
    function _executeHop(
        Pool storage pool,
        address tokenIn,
        uint256 amountIn,
        address recipient
    ) internal returns (uint256 amountOut) {
        (uint112 reserve0, uint112 reserve1) = (pool.reserve0, pool.reserve1);
        require(reserve0 > 0 && reserve1 > 0, "no reserves");

        bool zeroForOne = (tokenIn == pool.token0);
        uint256 amountInWithFee = (amountIn * (10000 - pool.feeBps)) / 10000;

        if (zeroForOne) {
            amountOut = _getAmountOut(amountInWithFee, reserve0, reserve1);
            pool.reserve0 = uint112(uint256(reserve0) + amountIn);
            pool.reserve1 = uint112(uint256(reserve1) - amountOut);
            _safeTransfer(pool.token1, recipient, amountOut);
        } else {
            amountOut = _getAmountOut(amountInWithFee, reserve1, reserve0);
            pool.reserve1 = uint112(uint256(reserve1) + amountIn);
            pool.reserve0 = uint112(uint256(reserve0) - amountOut);
            _safeTransfer(pool.token0, recipient, amountOut);
        }
        
        return amountOut;
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
