# QuantumDEX — Smart Contracts (Solidity/Hardhat)

This folder contains the Hardhat project for the Solidity version of our AMM DEX. We're porting the original Clarity implementation to Solidity, improving testability and adding modern security features.

## Quick start

```bash
cd QuantumDEX/smart-contracts
npm install
npx hardhat compile
npx hardhat test
```

## Project Structure (Planned)

```
contracts/
  ├── AMM.sol           # Main AMM implementation (port of amm.clar)
  ├── MockToken.sol     # ERC20 token for testing
  └── interfaces/       # Contract interfaces
tests/
  ├── AMM.test.ts      # Core contract tests
  └── helpers/         # Test utilities
scripts/
  └── deploy.ts        # Deployment script
```

## Contributing via Issues

Each task below will be created as a GitHub issue labeled `smart-contracts`. Pick an issue, create a branch, and submit a PR.

Smart Contract Tasks:

### Core Implementation

- ERC20 Mock Token

  - Description: Implement `MockToken.sol` with mint capability for testing
  - Features: ERC20 standard + public mint function
  - Priority: High (needed for testing)

- AMM Core Contract
  - Description: Port `amm.clar` core functions to Solidity
  - Features:
    - createPool(): Create trading pair + initial liquidity
    - addLiquidity(): Add to existing pool
    - removeLiquidity(): Remove liquidity + receive tokens
    - swap(): Execute trades with constant product formula
  - Priority: High (core functionality)

### Protocol Design

- Deterministic Pool ID

  - Description: Design pool identifier system
  - Features:
    - bytes32 pool id from token addresses + fee
    - Deterministic address ordering
  - Priority: High (architecture)

- Fee & Math Implementation
  - Description: Port Clarity math to safe Solidity
  - Features:
    - Safe math operations
    - Fee calculations matching Clarity
    - Integer division rounding rules
  - Priority: Medium

### Security & Testing

- Security Hardening

  - Description: Add modern security features
  - Features:
    - Reentrancy guards
    - Checks-Effects-Interactions pattern
    - Access control system
  - Priority: High

- Test Coverage
  - Description: Full test suite with edge cases
  - Features:
    - Unit tests for all functions
    - Integration tests for workflows
    - Gas optimization tests
  - Priority: Medium

## Workflow

1. Pick an issue labeled `smart-contracts`
2. Comment "Working on this"
3. Branch: `issue/<number>-<description>`
4. PR with:
   - Tests
   - Gas report
   - Security considerations

## PR Requirements

- [ ] Contracts compile without warnings
- [ ] All tests pass
- [ ] Gas optimizations documented
- [ ] Security review completed
- [ ] Event emissions verified

# QuantumDEX — Smart Contracts (Hardhat)

This folder contains the Hardhat TypeScript scaffold for the Solidity version of the AMM.

Quick start

```bash
cd QuantumDEX/smart-contracts
npm install
npx hardhat
```

Purpose

Port the Clarity AMM (`amm/contracts/amm.clar`) to Solidity and provide a testable Hardhat project.

Contributing via Issues

Each task below should be created as a GitHub issue with the `smart-contracts` label so contributors can pick and work on them.

Smart-contract issues (create one issue per bullet):

- ERC20 Mock Token

  - Short: Implement `MockToken.sol` (ERC20 with mint)
  - Description: Provide an ERC20 token with a public `mint` for tests.
  - Acceptance: Token compiles and can mint tokens to test accounts.

- AMM Core Contract

  - Short: Implement `AMM.sol` core functions
  - Description: Port createPool, addLiquidity, removeLiquidity, swap, getters, and events from Clarity to Solidity.
  - Acceptance: Contract compiles and exposes public functions and events.

- Deterministic Pool ID

  - Short: Pool identifier
  - Description: Choose bytes32 pool id derived from token addresses + fee; ensure deterministic ordering of token addresses.
  - Acceptance: Pool id stable across deployments and matches event data.

- Fee & Rounding Edge Cases

  - Short: Fee math safety
  - Description: Verify fee calculations and integer division rounding; add unit tests demonstrating behavior.
  - Acceptance: Tests cover rounding behavior and fee subtraction.

- Security: Reentrancy & Access Controls

  - Short: Hardening
  - Description: Add reentrancy guards and checks-effects-interactions; review visibility and access where needed.
  - Acceptance: Audit checklist and tests for common attack vectors.

- Unit Tests (Hardhat + Viem/Node test runner)
  - Short: Tests for core flows
  - Description: Add tests for pool creation, initial liquidity add, add/remove liquidity, and swaps.
  - Acceptance: Tests execute locally via `npx hardhat test` and pass.

Workflow

1. Pick an issue and comment "I am working on this".
2. Create a branch `issue/<id>-short-description`.
3. Open a PR referencing the issue and include test steps.

PR checklist

- [ ] Contracts compile
- [ ] Tests added/updated and passing
- [ ] Reviewed and approved
