# Smart Contracts Issues

This file contains all GitHub issues for the QuantumDEX smart contracts. Each issue is ready to be copied into GitHub.

**Note:** Contract addresses will be provided after deployment. Do not hardcode contract addresses in the codebase. Use environment variables or configuration files for contract addresses.

## ✅ Completed Issues

### Issue #1: ERC20 Mock Token
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `token`, `completed`

**Description:**
Implement `MockToken.sol` with mint capability for testing purposes.

**Acceptance Criteria:**
- [x] ERC20 standard implementation
- [x] Public `mint` function for testing
- [x] Configurable decimals
- [x] Ownable access control
- [x] Token compiles and can mint tokens to test accounts
- [x] Initial supply minted to deployer

**Implementation Notes:**
- Contract located at `contracts/MockToken.sol`
- Uses OpenZeppelin's ERC20 and Ownable
- `mint` function restricted to owner
- Auto-approves transfers for easier testing

---

### Issue #2: AMM Core Contract
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `core`, `completed`

**Description:**
Implement core AMM functions in Solidity. Implement createPool, addLiquidity, removeLiquidity, swap, getters, and events.

**Acceptance Criteria:**
- [x] `createPool(address tokenA, address tokenB, uint256 amountA, uint256 amountB)` function
- [x] `addLiquidity(bytes32 poolId, uint256 amount0Desired, uint256 amount1Desired)` function
- [x] `removeLiquidity(bytes32 poolId, uint256 liquidity)` function
- [x] `swap(bytes32 poolId, address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient)` function
- [x] `getPool(bytes32 poolId)` view function
- [x] `getLpBalance(bytes32 poolId, address account)` view function
- [x] `getPoolId(address tokenA, address tokenB, uint16 feeBps)` pure function
- [x] All events emitted (PoolCreated, LiquidityAdded, LiquidityRemoved, Swap)
- [x] Contract compiles without errors

**Implementation Notes:**
- Contract located at `contracts/AMM.sol`
- Uses OpenZeppelin's ReentrancyGuard and Ownable
- Constant product formula: `x * y = k`
- Fee calculation: `amountInWithFee = amountIn * (10000 - feeBps) / 10000`

---

### Issue #3: Deterministic Pool ID
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `architecture`, `completed`

**Description:**
Design pool identifier system with deterministic address ordering.

**Acceptance Criteria:**
- [x] Pool ID is `bytes32` derived from token addresses + fee
- [x] Deterministic address ordering (token0 < token1)
- [x] Pool ID stable across deployments
- [x] Pool ID matches event data
- [x] Prevents duplicate pools for same token pair + fee

**Implementation Notes:**
- Pool ID: `keccak256(abi.encodePacked(token0, token1, feeBps))`
- Token ordering: `token0 = min(tokenA, tokenB)`, `token1 = max(tokenA, tokenB)`
- Implemented in `getPoolId` function

---

### Issue #4: Fee & Math Implementation
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `math`, `completed`

**Description:**
Implement safe math operations in Solidity. Verify fee calculations and integer division rounding.

**Acceptance Criteria:**
- [x] Safe math operations (no overflow/underflow)
- [x] Fee calculations implemented correctly
- [x] Integer division rounding rules correct
- [x] Constant product formula implemented correctly
- [x] Sqrt function for liquidity calculation
- [x] Tests cover rounding behavior and fee subtraction

**Implementation Notes:**
- Uses Solidity 0.8+ built-in overflow protection
- Fee in basis points (bps): 30 = 0.30%
- Fee applied: `amountInWithFee = amountIn * (10000 - feeBps) / 10000`
- Swap formula: `amountOut = (amountInWithFee * reserveOut) / (reserveIn + amountInWithFee)`
- Liquidity: `liquidity = sqrt(amount0 * amount1)`

---

### Issue #5: Security Hardening
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `security`, `completed`

**Description:**
Add modern security features: reentrancy guards, checks-effects-interactions pattern, access control.

**Acceptance Criteria:**
- [x] Reentrancy guards on all state-changing functions
- [x] Checks-Effects-Interactions pattern followed
- [x] Access control where needed
- [x] Input validation on all functions
- [x] Safe token transfers
- [x] No known security vulnerabilities

**Implementation Notes:**
- Uses OpenZeppelin's `ReentrancyGuard`
- All external functions use `nonReentrant` modifier
- Uses `Ownable` for contract ownership
- Safe transfer functions: `_safeTransfer` and `_safeTransferFrom`
- Input validation: zero address checks, amount checks, pool existence checks

---

### Issue #6: Test Coverage
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `testing`, `completed`

**Description:**
Full test suite with edge cases covering all functions and workflows.

**Acceptance Criteria:**
- [x] Unit tests for all functions
- [x] Integration tests for workflows
- [x] Edge case tests
- [x] Gas optimization tests (if applicable)
- [x] Tests execute locally via `npx hardhat test`
- [x] All tests pass

**Implementation Notes:**
- Test file: `test/AMM.test.ts`
- Uses Hardhat with Viem
- Tests cover:
  - Pool creation and initial liquidity
  - Adding and removing liquidity
  - Swaps with fees
  - Constant product formula verification
  - Fee calculation accuracy
  - Slippage protection
  - Duplicate pool prevention
  - Minimum liquidity requirements

### Issue #7: Minimum Liquidity Lock
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `feature`, `security`, `completed`  
**Priority:** MEDIUM

**Description:**
Implement minimum liquidity lock mechanism to prevent pool drainage attacks. This locks a minimum amount of liquidity forever when the first liquidity is added to a pool.

**Acceptance Criteria:**
- [x] Define `MINIMUM_LIQUIDITY` constant (1000)
- [x] On first liquidity add, subtract `MINIMUM_LIQUIDITY` from minted liquidity
- [x] Lock `MINIMUM_LIQUIDITY` tokens forever (sent to address(0))
- [x] Ensure pool can never have zero liquidity
- [x] Update tests to verify minimum liquidity lock
- [x] Document the security rationale

**Implementation Notes:**
- `MINIMUM_LIQUIDITY` constant defined as 1000 (line 38 in AMM.sol)
- In `createPool`: locks MINIMUM_LIQUIDITY to `address(0)`, user receives `liquidity - MINIMUM_LIQUIDITY`
- In `removeLiquidity`: prevents removal that would leave pool below MINIMUM_LIQUIDITY
- Formula: `userLiquidity = sqrt(x * y) - MINIMUM_LIQUIDITY`
- Security rationale documented in README.md Security Features section

---

### Issue #8: Custom Fee Per Pool
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `feature`, `enhancement`, `completed`  
**Priority:** LOW

**Description:**
Allow users to specify custom fee when creating a pool, instead of using a global default fee.

**Acceptance Criteria:**
- [x] Modify `createPool` to accept optional `feeBps` parameter
- [x] If not provided, use `defaultFeeBps` (pass 0 to use default)
- [x] Validate fee is within acceptable range (1-1000 bps)
- [x] Store fee per pool in Pool struct (already existed)
- [x] Update `getPool` to return pool-specific fee (already returned feeBps)
- [x] Update tests
- [ ] Update frontend to support fee selection (frontend issue)

**Implementation Notes:**
- `createPool` now accepts `uint16 feeBps` parameter
- If `feeBps == 0`, uses `defaultFeeBps`
- Fee validation: `require(feeBps > 0 && feeBps <= 1000, "invalid fee")`
- Pool ID includes fee, so different fees create different pools
- All existing tests updated to pass `0` for feeBps
- New tests added for custom fees, validation, and different pools

---

### Issue #9: Native ETH Support
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `feature`, `enhancement`, `completed`  
**Priority:** LOW

**Description:**
Extend AMM to support native ETH (WETH) in addition to ERC20 tokens. This would allow users to trade ETH directly without wrapping.

**Current State:**
- ✅ Contract supports native ETH using address(0) pattern
- ✅ Users can trade ETH directly without wrapping

**Acceptance Criteria:**
- [x] Add support for native ETH (address(0) or special address)
- [x] Modify functions to handle ETH transfers
- [x] Use `payable` functions where needed
- [x] Handle ETH wrapping/unwrapping (native ETH handled directly, no wrapping needed)
- [x] Update all functions to support both ERC20 and ETH
- [x] Add tests for ETH swaps
- [ ] Update frontend to support ETH (frontend repo, not in scope for smart contracts)

**Technical Notes:**
- Can use WETH pattern or handle native ETH directly
- Need to modify transfer functions to handle `address(0)` as ETH
- Consider gas costs of wrapping/unwrapping

**Implementation Notes:**
- Native ETH support implemented using `address(0)` as ETH identifier
- `ETH` constant defined as `address(0)` in AMM contract
- All relevant functions (`createPool`, `addLiquidity`, `removeLiquidity`, `swap`) are `payable`
- `_safeTransfer` and `_safeTransferFrom` helper functions handle both ERC20 and ETH
- ETH validation ensures `msg.value` matches expected ETH amounts
- Comprehensive test suite covers ETH pool creation, liquidity operations, and swaps
- Contract located at `contracts/AMM.sol`
- Tests located at `test/AMM.test.ts` (Issue #9 test suite)

---

#### Issue 10: Multi-hop Swaps
**Status:** ✅ COMPLETED  
**Labels:** `smart-contracts`, `feature`, `enhancement`, `completed`  
**Priority:** LOW

**Description:**
Extend AMM to support native ETH (WETH) in addition to ERC20 tokens. This would allow users to trade ETH directly without wrapping.

**Current State:**
- ✅ Contract supports native ETH using address(0) pattern
- ✅ Users can trade ETH directly without wrapping

**Acceptance Criteria:**
- [x] Add support for native ETH (address(0) or special address)
- [x] Modify functions to handle ETH transfers
- [x] Use `payable` functions where needed
- [x] Handle ETH wrapping/unwrapping (native ETH handled directly, no wrapping needed)
- [x] Update all functions to support both ERC20 and ETH
- [x] Add tests for ETH swaps
- [ ] Update frontend to support ETH (frontend repo, not in scope for smart contracts)

**Technical Notes:**
- Can use WETH pattern or handle native ETH directly
- Need to modify transfer functions to handle `address(0)` as ETH
- Consider gas costs of wrapping/unwrapping

**Implementation Notes:**
- Native ETH support implemented using `address(0)` as ETH identifier
- `ETH` constant defined as `address(0)` in AMM contract
- All relevant functions (`createPool`, `addLiquidity`, `removeLiquidity`, `swap`) are `payable`
- `_safeTransfer` and `_safeTransferFrom` helper functions handle both ERC20 and ETH
- ETH validation ensures `msg.value` matches expected ETH amounts
- Comprehensive test suite covers ETH pool creation, liquidity operations, and swaps
- Contract located at `contracts/AMM.sol`
- Tests located at `test/AMM.test.ts` (Issue #9 test suite)

---

## ❌ Pending Issues

### Issue #11: Flash Loans
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `feature`, `advanced`  
**Priority:** LOW

**Description:**
Implement flash loan functionality to allow users to borrow tokens from pools without collateral, as long as they repay within the same transaction.

**Current State:**
- No flash loan functionality

**Acceptance Criteria:**
- [ ] Add `flashLoan` function
- [ ] Borrow tokens from pool
- [ ] Callback to user's contract
- [ ] Verify repayment + fee in same transaction
- [ ] Revert if not repaid
- [ ] Add tests
- [ ] Security audit recommended

**Technical Notes:**
- Standard flash loan pattern: borrow → callback → repay + fee
- Fee should be reasonable (e.g., 0.09% = 9 bps)
- Need to track borrowed amount and verify repayment
- High security risk - needs thorough testing and audit

---

### Issue #12: Gas Optimization
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `optimization`  
**Priority:** LOW

**Description:**
Optimize contract gas usage through storage packing, function optimization, and other techniques.

**Current State:**
- Contract works but may not be gas-optimized
- No gas benchmarks

**Acceptance Criteria:**
- [ ] Analyze gas usage of all functions
- [ ] Optimize storage layout (pack structs)
- [ ] Use custom errors instead of strings
- [ ] Optimize loops and calculations
- [ ] Add gas benchmarks
- [ ] Document gas savings
- [ ] Compare before/after gas costs

**Technical Notes:**
- Use `uint112` for reserves (packs with `uint16 feeBps` in one slot)
- Custom errors save gas vs. require strings
- Consider using `unchecked` blocks where safe
- Benchmark with Hardhat gas reporter

---

### Issue #13: Events Indexing Optimization
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `optimization`, `frontend`  
**Priority:** LOW

**Description:**
Optimize event emissions for better off-chain indexing and frontend querying.

**Current State:**
- Events are emitted but may not be optimized for indexing

**Acceptance Criteria:**
- [ ] Review all event parameters
- [ ] Ensure important fields are indexed
- [ ] Add events for state changes that frontend needs
- [ ] Consider adding `PoolUpdated` event for reserve changes
- [ ] Document event structure for frontend
- [ ] Test event querying performance

**Technical Notes:**
- Indexed parameters cost more gas but enable efficient filtering
- Frontend needs to query events efficiently
- Consider adding events for price changes, volume, etc.

---

### Issue #14: Upgradeability Pattern
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `architecture`, `advanced`  
**Priority:** LOW

**Description:**
Implement upgradeability pattern (e.g., Proxy pattern) to allow contract upgrades while preserving state.

**Current State:**
- Contract is not upgradeable
- Any changes require new deployment

**Acceptance Criteria:**
- [ ] Choose upgradeability pattern (UUPS, Transparent, Beacon)
- [ ] Implement proxy pattern
- [ ] Separate logic and storage contracts
- [ ] Add upgrade access control
- [ ] Add tests for upgrades
- [ ] Document upgrade process
- [ ] Security considerations

**Technical Notes:**
- UUPS (Universal Upgradeable Proxy Standard) recommended
- Need to separate storage from logic
- Upgrade should be controlled by governance or timelock
- High security risk - needs audit

---

### Issue #15: Governance Integration
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `feature`, `governance`  
**Priority:** LOW

**Description:**
Add governance mechanism to allow token holders to vote on protocol parameters (fees, upgrades, etc.).

**Current State:**
- No governance mechanism
- Owner has full control

**Acceptance Criteria:**
- [ ] Design governance token or use existing
- [ ] Implement voting mechanism
- [ ] Proposals for parameter changes
- [ ] Timelock for execution
- [ ] Quorum and voting thresholds
- [ ] Tests for governance
- [ ] Documentation

**Technical Notes:**
- Can use OpenZeppelin's Governor contracts
- Consider snapshot voting vs. on-chain voting
- Need to define governance token distribution

---

---

## Token Streaming Protocol Issues

### Issue #16: Token Streaming Core Contract
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `token-streaming`, `core`  
**Priority:** HIGH

**Description:**
Implement the Token Streaming protocol contract in Solidity. Port the streaming functionality to work with ERC20 tokens on Ethereum/Base. The contract should enable continuous payment streams between parties.

**Acceptance Criteria:**
- [ ] `createStream(recipient, token, initialBalance, timeframe, paymentPerBlock)` - Create a new payment stream
- [ ] `refuel(streamId, amount)` - Add more tokens to an existing stream (sender only)
- [ ] `withdraw(streamId)` - Withdraw accumulated tokens (recipient only)
- [ ] `refund(streamId)` - Withdraw excess tokens after stream ends (sender only)
- [ ] `updateStreamDetails(streamId, paymentPerBlock, timeframe, signature)` - Update stream parameters with dual-party consent
- [ ] `getStream(streamId)` - Get stream information
- [ ] `getWithdrawableBalance(streamId, account)` - Get withdrawable balance for an account
- [ ] `hashStream(streamId, newPaymentPerBlock, newTimeframe)` - Get hash for signature verification
- [ ] `validateSignature(hash, signature, signer)` - Verify ECDSA signatures
- [ ] All events emitted (StreamCreated, StreamRefueled, TokensWithdrawn, StreamRefunded, StreamUpdated)
- [ ] Contract compiles without errors
- [ ] Reentrancy protection
- [ ] Input validation

**Technical Notes:**
- Use ERC20 tokens (not native ETH initially)
- Stream ID: auto-incrementing `uint256`
- Timeframe: `struct Timeframe { uint256 startBlock; uint256 endBlock; }`
- Payment calculation: `withdrawable = (currentBlock - startBlock) * paymentPerBlock - withdrawnBalance`
- Signature verification using ECDSA (ecrecover)
- Use OpenZeppelin's ReentrancyGuard
- **Contract Address:** Will be deployed to Base Sepolia/Base. Address will be provided after deployment.

---

### Issue #17: Token Streaming Test Suite
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `token-streaming`, `testing`  
**Priority:** HIGH  
**Depends on:** #16

**Description:**
Create comprehensive test suite for the Token Streaming contract covering all functions, edge cases, and security scenarios.

**Acceptance Criteria:**
- [ ] Tests for stream creation
- [ ] Tests for refueling streams
- [ ] Tests for withdrawing tokens (recipient)
- [ ] Tests for refunding excess tokens (sender)
- [ ] Tests for updating stream details with signatures
- [ ] Tests for signature verification
- [ ] Tests for unauthorized access attempts
- [ ] Tests for edge cases (stream not started, stream ended, etc.)
- [ ] Tests for balance calculations
- [ ] Tests for time-based calculations
- [ ] All tests pass
- [ ] Test coverage > 80%

**Technical Notes:**
- Use Hardhat with Viem for testing
- Test signature generation and verification
- Test block-based time calculations
- Test reentrancy protection

---

### Issue #18: Token Streaming - Native ETH Support
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `token-streaming`, `enhancement`  
**Priority:** MEDIUM  
**Depends on:** #16

**Description:**
Extend Token Streaming contract to support native ETH in addition to ERC20 tokens. Allow users to create streams using ETH directly.

**Acceptance Criteria:**
- [ ] Modify `createStream` to accept native ETH
- [ ] Handle ETH transfers (msg.value)
- [ ] Modify `refuel` to accept ETH
- [ ] Modify `withdraw` and `refund` to send ETH
- [ ] Update all functions to handle both ERC20 and ETH
- [ ] Add tests for ETH streams
- [ ] Update events to indicate token type

**Technical Notes:**
- Use `address(0)` or special address to represent ETH
- Use `transfer()` for ETH transfers
- Consider using WETH pattern as alternative

---

### Issue #19: Token Streaming - Stream Cancellation
**Status:** ❌ PENDING  
**Labels:** `smart-contracts`, `token-streaming`, `feature`  
**Priority:** LOW  
**Depends on:** #16

**Description:**
Add functionality to cancel active streams with consent from both parties. Cancelled streams should allow both parties to withdraw their respective balances.

**Acceptance Criteria:**
- [ ] `cancelStream(streamId, signature)` function
- [ ] Requires signature from counterparty
- [ ] Calculates final balances for both parties
- [ ] Allows withdrawal of remaining balances
- [ ] Emits StreamCancelled event
- [ ] Tests for cancellation flow

**Technical Notes:**
- Similar signature verification as `updateStreamDetails`
- Calculate balances up to cancellation block
- Distribute remaining tokens proportionally

---

## Issue Template

When creating issues in GitHub, use this format:

```markdown
## Description
[Copy description from above]

## Acceptance Criteria
[Copy acceptance criteria from above]

## Technical Notes
[Copy technical notes if any]

## Dependencies
[List any blocking issues]

## Labels
[Add appropriate labels]

## Priority
[High/Medium/Low]
```

